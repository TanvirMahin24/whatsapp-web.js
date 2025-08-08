import { useState, useEffect } from "react";
import { io } from "socket.io-client";
import axios from "axios";
import "./App.css";

const API_BASE_URL =
    import.meta.env.VITE_API_BASE_URL || "http://localhost:3000/api";
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:3000";
const APP_TITLE = import.meta.env.VITE_APP_TITLE || "WhatsApp Web Interface";

function App() {
    const [status, setStatus] = useState({
        isAuthenticated: false,
        isReady: false,
    });
    const [qrCode, setQrCode] = useState(null);
    const [phoneNumber, setPhoneNumber] = useState("");
    const [message, setMessage] = useState("");
    const [contacts, setContacts] = useState([]);
    const [chats, setChats] = useState([]);
    const [selectedChat, setSelectedChat] = useState(null);
    const [chatMessages, setChatMessages] = useState([]);
    const [loading, setLoading] = useState(false);
    const [notification, setNotification] = useState(null);
    const [activeTab, setActiveTab] = useState("send");

    useEffect(() => {
        // Initialize socket connection
        const newSocket = io(SOCKET_URL);

        // Socket event listeners
        newSocket.on("status", (data) => {
            setStatus(data);
        });

        newSocket.on("qr", (qrData) => {
            setQrCode(qrData);
        });

        newSocket.on("message", (messageData) => {
            showNotification(
                `New message from ${messageData.from}: ${messageData.body}`,
                "info"
            );
            // Add new message to chat if it's from the selected chat
            if (selectedChat && messageData.from === selectedChat.id) {
                setChatMessages((prev) => [...prev, messageData]);
            }
        });

        return () => {
            newSocket.close();
        };
    }, [selectedChat]);

    const showNotification = (message, type = "info") => {
        setNotification({ message, type });
        setTimeout(() => setNotification(null), 5000);
    };

    const sendMessage = async () => {
        if (!phoneNumber || !message) {
            showNotification(
                "Please enter both phone number and message",
                "error"
            );
            return;
        }

        setLoading(true);
        try {
            const response = await axios.post(`${API_BASE_URL}/send-message`, {
                number: phoneNumber,
                message: message,
            });

            if (response.data.success) {
                showNotification("Message sent successfully!", "success");
                setPhoneNumber("");
                setMessage("");
            }
        } catch (error) {
            showNotification(
                error.response?.data?.error || "Failed to send message",
                "error"
            );
        } finally {
            setLoading(false);
        }
    };

    const loadContacts = async () => {
        try {
            const response = await axios.get(`${API_BASE_URL}/contacts`);
            setContacts(response.data.contacts);
            showNotification(
                `Loaded ${response.data.contacts.length} contacts`,
                "success"
            );
        } catch {
            showNotification("Failed to load contacts", "error");
        }
    };

    const loadChats = async () => {
        try {
            const response = await axios.get(`${API_BASE_URL}/chats`);
            setChats(response.data.chats);
            showNotification(
                `Loaded ${response.data.chats.length} chats`,
                "success"
            );
        } catch {
            showNotification("Failed to load chats", "error");
        }
    };

    const loadChatMessages = async (chatId) => {
        try {
            const response = await axios.get(
                `${API_BASE_URL}/chat-messages/${chatId}`
            );
            setChatMessages(response.data.messages);
        } catch {
            showNotification("Failed to load chat messages", "error");
        }
    };

    const selectContact = (number) => {
        setPhoneNumber(number);
        setActiveTab("send");
    };

    const selectChat = (chat) => {
        setSelectedChat(chat);
        loadChatMessages(chat.id);
    };

    const getStatusColor = () => {
        if (status.isReady) return "#10B981";
        if (status.isAuthenticated) return "#F59E0B";
        return "#EF4444";
    };

    const getStatusText = () => {
        if (status.isReady) return "Connected";
        if (status.isAuthenticated) return "Authenticating";
        return "Disconnected";
    };

    const formatTime = (timestamp) => {
        if (!timestamp) return "";
        const date = new Date(timestamp * 1000);
        return date.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
        });
    };

    return (
        <div className="app">
            <div className="container">
                {/* Header */}
                <header className="header">
                    <div className="header-content">
                        <h1>{APP_TITLE}</h1>
                        <div className="status-indicator">
                            <div
                                className="status-dot"
                                style={{ backgroundColor: getStatusColor() }}
                            ></div>
                            <span className="status-text">
                                {getStatusText()}
                            </span>
                        </div>
                    </div>
                </header>

                {/* QR Code Section */}
                {(!status.isAuthenticated || !status.isReady || qrCode) && (
                    <div className="qr-section">
                        <div className="qr-content">
                            <h3>Scan QR Code</h3>
                            <p>
                                Open WhatsApp on your phone and scan this code
                            </p>
                            {qrCode ? (
                                <div className="qr-container">
                                    <img
                                        src={qrCode}
                                        alt="QR Code"
                                        className="qr-image"
                                    />
                                </div>
                            ) : (
                                <div className="qr-loading">
                                    <p>Waiting for QR code...</p>
                                    <div className="loading-spinner"></div>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Main Interface */}
                {status.isAuthenticated && status.isReady && (
                    <div className="main-interface">
                        {/* Tab Navigation */}
                        <div className="tab-navigation">
                            <button
                                className={`tab-button ${
                                    activeTab === "send" ? "active" : ""
                                }`}
                                onClick={() => setActiveTab("send")}
                            >
                                Send Message
                            </button>
                            <button
                                className={`tab-button ${
                                    activeTab === "contacts" ? "active" : ""
                                }`}
                                onClick={() => setActiveTab("contacts")}
                            >
                                Contacts
                            </button>
                            <button
                                className={`tab-button ${
                                    activeTab === "chats" ? "active" : ""
                                }`}
                                onClick={() => setActiveTab("chats")}
                            >
                                Chats
                            </button>
                        </div>

                        {/* Tab Content */}
                        <div className="tab-content">
                            {activeTab === "send" && (
                                <div className="send-section">
                                    <div className="form-group">
                                        <label>Phone Number</label>
                                        <input
                                            type="text"
                                            value={phoneNumber}
                                            onChange={(e) =>
                                                setPhoneNumber(e.target.value)
                                            }
                                            placeholder="e.g., 1234567890"
                                            className="form-input"
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label>Message</label>
                                        <textarea
                                            value={message}
                                            onChange={(e) =>
                                                setMessage(e.target.value)
                                            }
                                            placeholder="Type your message here..."
                                            rows="4"
                                            className="form-textarea"
                                        />
                                    </div>
                                    <button
                                        onClick={sendMessage}
                                        disabled={loading}
                                        className="send-button"
                                    >
                                        {loading
                                            ? "Sending..."
                                            : "Send Message"}
                                    </button>
                                </div>
                            )}

                            {activeTab === "contacts" && (
                                <div className="contacts-section">
                                    <div className="section-header">
                                        <h3>Contacts</h3>
                                        <button
                                            onClick={loadContacts}
                                            className="load-button"
                                        >
                                            Load Contacts
                                        </button>
                                    </div>
                                    <div className="contacts-list">
                                        {contacts.map((contact) => (
                                            <div
                                                key={contact.id}
                                                className="contact-item"
                                                onClick={() =>
                                                    selectContact(
                                                        contact.number
                                                    )
                                                }
                                            >
                                                <div className="contact-avatar">
                                                    {contact.name
                                                        .charAt(0)
                                                        .toUpperCase()}
                                                </div>
                                                <div className="contact-info">
                                                    <div className="contact-name">
                                                        {contact.name}
                                                    </div>
                                                    <div className="contact-number">
                                                        {contact.number}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {activeTab === "chats" && (
                                <div className="chats-section">
                                    <div className="section-header">
                                        <h3>Recent Chats</h3>
                                        <button
                                            onClick={loadChats}
                                            className="load-button"
                                        >
                                            Load Chats
                                        </button>
                                    </div>

                                    {!selectedChat ? (
                                        <div className="chats-list">
                                            {chats.map((chat) => (
                                                <div
                                                    key={chat.id}
                                                    className="chat-item"
                                                    onClick={() =>
                                                        selectChat(chat)
                                                    }
                                                >
                                                    <div className="chat-avatar">
                                                        {chat.name
                                                            .charAt(0)
                                                            .toUpperCase()}
                                                        {chat.isGroup && (
                                                            <span className="group-indicator">
                                                                👥
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="chat-info">
                                                        <div className="chat-name">
                                                            {chat.name}
                                                        </div>
                                                        <div className="chat-id">
                                                            {chat.id}
                                                        </div>
                                                    </div>
                                                    {chat.unreadCount > 0 && (
                                                        <span className="unread-badge">
                                                            {chat.unreadCount}
                                                        </span>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="chat-messages-section">
                                            <div className="chat-header">
                                                <button
                                                    className="back-button"
                                                    onClick={() =>
                                                        setSelectedChat(null)
                                                    }
                                                >
                                                    ← Back to Chats
                                                </button>
                                                <h3>{selectedChat.name}</h3>
                                            </div>

                                            <div className="messages-container">
                                                {chatMessages.length > 0 ? (
                                                    chatMessages.map(
                                                        (msg, index) => (
                                                            <div
                                                                key={index}
                                                                className={`message ${
                                                                    msg.fromMe
                                                                        ? "sent"
                                                                        : "received"
                                                                }`}
                                                            >
                                                                <div className="message-content">
                                                                    <div className="message-text">
                                                                        {
                                                                            msg.body
                                                                        }
                                                                    </div>
                                                                    <div className="message-time">
                                                                        {formatTime(
                                                                            msg.timestamp
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        )
                                                    )
                                                ) : (
                                                    <div className="no-messages">
                                                        <p>
                                                            No messages in this
                                                            chat yet.
                                                        </p>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Notification */}
                {notification && (
                    <div className={`notification ${notification.type}`}>
                        {notification.message}
                    </div>
                )}
            </div>
        </div>
    );
}

export default App;
