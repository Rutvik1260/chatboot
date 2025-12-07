import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import SockJS from "sockjs-client";
import { Client } from "@stomp/stompjs";

import SearchBar from "../components/other/SearchBar";
import axios from "axios";

var stompClient = null; // we'll store the Client instance here

export const ChatPage2 = () => {
  const [selectedUser, setSelectedUser] = useState(null);
  const [receiver, setReceiver] = useState("");
  const [message, setMessage] = useState("");
  const [media, setMedia] = useState("");
  const [tab, setTab] = useState("CHATROOM");
  const [publicChats, setPublicChats] = useState([]);
  const [privateChats, setPrivateChats] = useState(new Map());
  const [username] = useState(localStorage.getItem("chat-username"));
  const navigate = useNavigate();
  const connected = useRef(false);

  if (!username || !username.trim()) {
    navigate("/login");
  }

  useEffect(() => {
    if (!connected.current) {
      connect();
    }
    return () => {
      if (stompClient) {
        // deactivate returns a promise; call without awaiting in cleanup
        try {
          stompClient.deactivate();
        } catch (e) {
          console.warn("Error deactivating STOMP client:", e);
        }
        connected.current = false;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePrivateMessage = (user) => {
    setSelectedUser(user);
    setReceiver(user.username);

    if (!privateChats.has(user.username)) {
      privateChats.set(user.username, []);
      setPrivateChats(new Map(privateChats));
    }
  };

  const onMessageReceived = (messageObj) => {
    // messageObj is a Stomp Message from @stomp/stompjs
    try {
      const payloadData = JSON.parse(messageObj.body);
      console.log("Public message received:", payloadData);
      switch (payloadData.status) {
        case "JOIN":
          if (payloadData.senderName !== username) {
            if (!privateChats.get(payloadData.senderName)) {
              privateChats.set(payloadData.senderName, []);
              setPrivateChats(new Map(privateChats));
            }
          }
          break;
        case "LEAVE":
          if (payloadData.senderName !== username) {
            if (privateChats.get(payloadData.senderName)) {
              privateChats.delete(payloadData.senderName);
              setPrivateChats(new Map(privateChats));
            }
          }
          break;
        case "MESSAGE":
          setPublicChats((prev) => [...prev, payloadData]);
          break;
        default:
          console.warn("Unknown status received:", payloadData.status);
      }
    } catch (err) {
      console.error("Failed to parse public message:", err, messageObj);
    }
  };

  const onPrivateMessage = (messageObj) => {
    try {
      const payloadData = JSON.parse(messageObj.body);
      console.log("Private message received:", payloadData);
      if (privateChats.has(payloadData.senderName)) {
        privateChats.get(payloadData.senderName).push(payloadData);
      } else {
        privateChats.set(payloadData.senderName, [payloadData]);
      }
      setPrivateChats(new Map(privateChats));
    } catch (err) {
      console.error("Failed to parse private message:", err, messageObj);
    }
  };

  const onConnect = () => {
    console.log("Connected to WebSocket");
    connected.current = true;

    // subscribe to public and private destinations
    stompClient.subscribe("/chatroom/public", (msg) => onMessageReceived(msg));
    stompClient.subscribe(`/user/${username}/private`, (msg) =>
      onPrivateMessage(msg)
    );

    userJoin();
  };

  const onError = (err) => {
    console.error("WebSocket connection error:", err);
  };

  const connect = () => {
    // create STOMP Client using SockJS as transport
    const client = new Client({
      // provide a factory that returns a SockJS instance
      webSocketFactory: () => new SockJS("http://localhost:8080/ws"),
      reconnectDelay: 5000,
      heartbeatIncoming: 0,
      heartbeatOutgoing: 20000,
      onConnect: () => onConnect(),
      onStompError: (frame) => {
        console.error("Broker reported error: " + frame.headers["message"]);
        console.error("Additional details: " + frame.body);
      },
      onWebSocketError: (evt) => onError(evt),
      // optional debug
      debug: (str) => {
        // console.debug("[STOMP]", str);
      },
    });

    stompClient = client;
    client.activate();
  };

  const userJoin = () => {
    let chatMessage = {
      senderName: username,
      status: "JOIN",
    };

    if (stompClient && stompClient.connected) {
      stompClient.publish({
        destination: "/app/message",
        body: JSON.stringify(chatMessage),
      });
    } else {
      console.warn("STOMP client not connected yet (userJoin).");
    }
  };

  const userLeft = () => {
    let chatMessage = {
      senderName: username,
      status: "LEAVE",
    };

    if (stompClient && stompClient.connected) {
      stompClient.publish({
        destination: "/app/message",
        body: JSON.stringify(chatMessage),
      });
    }
  };

  const handleLogout = () => {
    userLeft();
    localStorage.removeItem("chat-username");
    navigate("/login");
  };

  // Handle file conversion to base64
  const base64ConversionForImages = (e) => {
    if (e.target.files && e.target.files[0]) {
      getBase64(e.target.files[0]);
    }
  };

  const getBase64 = (file) => {
    let reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => setMedia(reader.result);
    reader.onerror = (error) => console.error("Error converting file:", error);
  };

  const sendMessage = () => {
    if ((message && message.trim().length > 0) || media) {
      if (stompClient && stompClient.connected) {
        stompClient.publish({
          destination: "/app/message",
          body: JSON.stringify({
            senderName: username,
            status: "MESSAGE",
            media: media,
            message: message,
          }),
        });
        setMessage("");
        setMedia("");
      } else {
        console.warn("STOMP client not connected (sendMessage).");
      }
    }
  };

  const sendPrivate = () => {
    if (message && message.trim().length > 0 && receiver) {
      let chatMessage = {
        senderName: username,
        receiverName: receiver,
        message: message,
        media: media,
        status: "MESSAGE",
      };

      if (privateChats.get(receiver)) {
        privateChats.get(receiver).push(chatMessage);
      } else {
        privateChats.set(receiver, [chatMessage]);
      }
      setPrivateChats(new Map(privateChats));

      if (stompClient && stompClient.connected) {
        stompClient.publish({
          destination: "/app/private-message",
          body: JSON.stringify(chatMessage),
        });
      } else {
        console.warn("STOMP client not connected (sendPrivate).");
      }

      setMessage("");
      setMedia("");
    }
  };

  const tabReceiverSet = (name) => {
    setReceiver(name);
    setTab(name);
  };

  const fetchChatHistory = async (user1, user2) => {
    try {
      const response = await axios.get(
        `http://localhost:8080/api/messages/history/${user1}/${user2}`
      );

      if (response.status === 200) {
        // Assuming response.data is an array of messages
        setPrivateChats((prevChats) => {
          prevChats.set(user2, response.data);
          return new Map(prevChats);
        });
      } else {
        console.error("Failed to fetch chat history:", response.status);
      }
    } catch (error) {
//       console.error("Error fetching chat history:", error);
    }
  };

  return (
    <div className="flex items-center justify-center h-screen w-[100%]">
      <div className="flex w-full h-full">
        {/* Member List */}
        <div className="flex flex-col p-3 w-[200px] h-[551px] bg-transparent">
          <ul className="list-none space-y-2">
            <li
              key={"o"}
              className={`p-2 cursor-pointer rounded ${
                tab === "CHATROOM" ? "bg-blue-500 text-white" : "bg-gray-200"
              }`}
              onClick={() => setTab("CHATROOM")}
            >
              <span>Chat Room</span>
            </li>
            {[...privateChats.keys()].map((name, index) => (
              <li
                key={index}
                onClick={() => {
                  tabReceiverSet(name);
                  fetchChatHistory(username, name); // Fetch chat history when clicking on user tab
                }}
                className={`p-2 cursor-pointer rounded ${
                  tab === name ? "bg-blue-500 text-white" : "bg-gray-200"
                }`}
              >
                <span className="text-lg">{name}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col w-[50%] mt-3">
          {/* Chat Box */}
          <div
            className="p-3 flex-grow overflow-hidden bg-gray-300 border border-green-500 flex flex-col space-y-2 rounded-md"
            style={{ height: "500px" }}
          >
            {tab === "CHATROOM"
              ? publicChats.map((message, index) => (
                  <div
                    className={`flex ${
                      message.senderName !== username
                        ? "justify-start"
                        : "justify-end"
                    }`}
                    key={index}
                  >
                    <div
                      className={`p-2 flex flex-col max-w-lg ${
                        message.senderName !== username
                          ? "bg-white rounded-t-lg rounded-r-lg"
                          : "bg-blue-500 rounded-t-lg rounded-l-lg"
                      }`}
                    >
                      {message.senderName !== username && (
                        <div className="rounded bg-blue-400 mb-2 p-1 text-white">
                          {message.senderName}
                        </div>
                      )}
                      <div
                        className={
                          message.senderName === username ? "text-white" : ""
                        }
                      >
                        {message.message}
                      </div>
                      {message.media &&
                        message.media
                          .split(";")[0]
                          .split("/")[0]
                          .split(":")[1] === "image" && (
                          <img src={message.media} alt="" width={"250px"} />
                        )}
                      {message.media &&
                        message.media
                          .split(";")[0]
                          .split("/")[0]
                          .split(":")[1] === "video" && (
                          <video width="320" height="240" controls>
                            <source src={message.media} type="video/mp4" />
                          </video>
                        )}
                    </div>
                  </div>
                ))
              : (privateChats.get(tab) || []).map((message, index) => (
                  <div
                    className={`flex ${
                      message.senderName !== username
                        ? "justify-start"
                        : "justify-end"
                    }`}
                    key={index}
                  >
                    <div
                      className={`p-2 flex flex-col max-w-lg ${
                        message.senderName !== username
                          ? "bg-white rounded-t-lg rounded-r-lg"
                          : "bg-blue-500 rounded-t-lg rounded-l-lg"
                      }`}
                    >
                      <div
                        className={message.senderName === username ? "text-white" : ""}
                      >
                        {message.message}
                      </div>
                      {message.media &&
                        message.media
                          .split(";")[0]
                          .split("/")[0]
                          .split(":")[1] === "image" && (
                          <img src={message.media} alt="" width={"250px"} />
                        )}
                      {message.media &&
                        message.media
                          .split(";")[0]
                          .split("/")[0]
                          .split(":")[1] === "video" && (
                          <video width="320" height="240" controls>
                            <source src={message.media} type="video/mp4" />
                          </video>
                        )}
                    </div>
                  </div>
                ))}
          </div>

          {/* Message Box */}
          <div className="flex items-center p-2">
            <input
              className="flex-grow p-2 border outline-blue-600 rounded-l-lg"
              type="text"
              placeholder="Message"
              value={message}
              onKeyUp={(e) => {
                if (e.key === "Enter" || e.key === 13) {
                  tab === "CHATROOM" ? sendMessage() : sendPrivate();
                }
              }}
              onChange={(e) => setMessage(e.target.value)}
            />
            <label
              htmlFor="file"
              className="p-2 bg-blue-700 text-white rounded-r-none cursor-pointer"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="24"
                fill="currentColor"
                className="bi bi-paperclip"
                viewBox="0 0 16 16"
              >
                <path d="M4.5 3a2.5 2.5 0 0 1 5 0v9a1.5 1.5 0 0 1-3 0V5a.5.5 0 0 1 1 0v7a.5.5 0 0 0 1 0V3a1.5 1.5 0 1 0-3 0v9a2.5 2.5 0 0 0 5 0V5a.5.5 0 0 1 1 0v7a3.5 3.5 0 1 1-7 0V3z" />
              </svg>
            </label>
            <input
              id="file"
              type="file"
              onChange={(e) => base64ConversionForImages(e)}
              className="hidden"
            />
            <input
              type="button"
              className="ml-2 p-2 bg-blue-700 text-white rounded cursor-pointer"
              value="Send"
              onClick={tab === "CHATROOM" ? sendMessage : sendPrivate}
            />
            <input
              type="button"
              className="ml-2 p-2 bg-blue-700 text-white rounded cursor-pointer"
              value="Logout"
              onClick={handleLogout}
            />
          </div>
        </div>
        <div className="pl-4 pt-3">
          <SearchBar onUserSelect={handlePrivateMessage} />
        </div>
      </div>
    </div>
  );
};
