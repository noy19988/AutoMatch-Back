// live_stream_controller.ts
import { Server as SocketIOServer } from "socket.io";
import { Server as HTTPServer } from "http";
import TournamentModel from "../models/tournament_model";
import userModel from "../models/user_model";
import { Request, Response } from "express";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { pollTournamentResults } from "./lichess_controller";




// Define message structure for chat
interface ChatMessage {
  username: string;
  lichessId: string;
  message: string;
  timestamp: Date;
  tournamentId: string;
}

// Store active chat rooms and recent messages
const chatRooms = new Map<string, ChatMessage[]>();
const MAX_MESSAGES = 100; // Maximum number of messages to store per tournament

/**
 * Initialize Socket.IO server for live streaming and chat functionality
 */
export const initializeSocketServer = (server: HTTPServer) => {
  const io = new SocketIOServer(server, {
    cors: {
      origin: "*", // Allow all origins for testing
      methods: ["GET", "POST", "OPTIONS"],
      credentials: true,
      allowedHeaders: ["*"]
    },
    pingTimeout: 60000, // Increase timeout values
    pingInterval: 25000,
    transports: ['websocket', 'polling'] // Try websocket first
  });

  console.log("🔌 Initializing socket.io server for live streaming and chat");

  // Socket connection handling
  io.on("connection", async (socket) => {
    console.log(`🟢 User connected: ${socket.id}, IP: ${socket.handshake.address}`);
    let currentTournamentId: string | null = null;
    let currentUser: { lichessId: string; _id: string } | null = null;

    // Handle joining tournament room
    socket.on("join_tournament", async (data: { tournamentId: string; token?: string; lichessId?: string }) => {
      try {
        console.log(`📥 Join tournament request:`, data);
        
        if (!data.tournamentId) {
          socket.emit("error", { message: "Tournament ID is required" });
          return;
        }

        currentTournamentId = data.tournamentId;
        
        // Verify tournament exists
        const tournament = await TournamentModel.findById(data.tournamentId);
        if (!tournament) {
          console.error(`❌ Tournament not found: ${data.tournamentId}`);
          socket.emit("error", { message: "Tournament not found" });
          return;
        }

        console.log(`✅ Tournament found: ${tournament.tournamentName}`);

        // Identify user if token provided
        if (data.token) {
          try {
            const userId = verifyToken(data.token);
            const user = await userModel.findById(userId);
            if (user && user.lichessId) {
              currentUser = {
                lichessId: user.lichessId,
                _id: user._id.toString()
              };
              console.log(`🔍 User identified from token: ${user.lichessId}`);
            }
          } catch (error) {
            console.warn("⚠️ Invalid token:", error);
            // Continue as anonymous user
          }
        } else if (data.lichessId) {
          // User provided lichessId directly (less secure but allowed)
          const user = await userModel.findOne({ lichessId: data.lichessId });
          if (user) {
            currentUser = {
              lichessId: data.lichessId,
              _id: user._id.toString()
            };
            console.log(`🔍 User found by lichessId: ${data.lichessId}`);
          } else {
            currentUser = {
              lichessId: data.lichessId || 'anonymous',
              _id: "guest"
            };
            console.log(`👤 Anonymous user with lichessId: ${data.lichessId || 'anonymous'}`);
          }
        } else {
          // Create a generic guest user for anyone without identification
          currentUser = {
            lichessId: `guest-${socket.id.substring(0, 8)}`,
            _id: "guest"
          };
          console.log(`👤 Created guest user: ${currentUser.lichessId}`);
        }

        // Join the tournament room
        socket.join(data.tournamentId);
        console.log(`👥 User ${currentUser?.lichessId} joined tournament room: ${data.tournamentId}`);
        
        // Send back current active matches
        const currentMatches = await getCurrentMatches(data.tournamentId);
        console.log(`📤 Sending ${currentMatches.length} matches to client`);
        socket.emit("tournament_matches", currentMatches);
        
        // Send recent chat history
        if (!chatRooms.has(data.tournamentId)) {
          chatRooms.set(data.tournamentId, []);
          console.log(`🗨️ Created new chat room for tournament ${data.tournamentId}`);
        }
        
        const chatHistory = chatRooms.get(data.tournamentId) || [];
        console.log(`📤 Sending ${chatHistory.length} chat messages to client`);
        socket.emit("chat_history", chatHistory);
        
        // Notify room about new user
        if (currentUser) {
          socket.to(data.tournamentId).emit("user_joined", {
            lichessId: currentUser.lichessId,
            timestamp: new Date()
          });
        }
        
        // Return success acknowledgment
        socket.emit("join_success", { 
          tournamentId: data.tournamentId,
          userId: currentUser?.lichessId
        });
        
      } catch (error) {
        console.error("❌ Error joining tournament room:", error);
        socket.emit("error", { message: "Failed to join tournament room", details: error instanceof Error ? error.message : String(error) });
      }
    });

    // Handle chat messages
    socket.on("send_message", async (data: { message: string; tournamentId: string; token?: string }) => {
      try {
        console.log(`📝 Chat message received:`, data);
        
        if (!data.message || !data.tournamentId) {
          socket.emit("error", { message: "Message and tournament ID are required" });
          return;
        }

        // Allow anyone to send messages in debug/testing mode
        if (!currentUser) {
          console.log(`⚠️ Creating temporary user for chat message`);
          currentUser = {
            lichessId: `guest-${socket.id.substring(0, 8)}`,
            _id: "guest"
          };
        }

        // Create message object
        const chatMessage: ChatMessage = {
          username: currentUser.lichessId,
          lichessId: currentUser.lichessId,
          message: data.message,
          timestamp: new Date(),
          tournamentId: data.tournamentId
        };

        console.log(`💬 New message from ${chatMessage.username}: ${chatMessage.message}`);

        // Add to chat history
        if (!chatRooms.has(data.tournamentId)) {
          chatRooms.set(data.tournamentId, []);
        }
        
        const roomMessages = chatRooms.get(data.tournamentId)!;
        roomMessages.push(chatMessage);
        
        // Limit history size
        if (roomMessages.length > MAX_MESSAGES) {
          chatRooms.set(data.tournamentId, roomMessages.slice(-MAX_MESSAGES));
        }

        // Broadcast message to room
        io.to(data.tournamentId).emit("new_message", chatMessage);
        console.log(`📢 Message broadcasted to tournament room: ${data.tournamentId}`);
        
        // Return success acknowledgment
        socket.emit("message_sent", { success: true });
      } catch (error) {
        console.error("❌ Error sending message:", error);
        socket.emit("error", { message: "Failed to send message", details: error instanceof Error ? error.message : String(error) });
      }
    });

    // Handle game updates (when Lichess games change state)
    socket.on("game_update", async (data: { gameId: string; tournamentId: string; state: any; token?: string }) => {
      try {
        if (!data.gameId || !data.tournamentId || !data.state) {
          return;
        }
        
        console.log(`🎮 Game update received for ${data.gameId} in tournament ${data.tournamentId}`);
        
        // Broadcast update to tournament room
        io.to(data.tournamentId).emit("game_state_change", {
          gameId: data.gameId,
          state: data.state
        });
        
        // Check if the match is finished and notify room
        if (data.state.status === "mate" || 
            data.state.status === "resign" || 
            data.state.status === "timeout" ||
            data.state.status === "draw") {
          
          console.log(`🏁 Game ${data.gameId} finished with status: ${data.state.status}`);
          
          const tournament = await TournamentModel.findById(data.tournamentId);
          if (tournament) {
            // Find the match in the tournament
            let matchInfo = null;
            
            for (const bracket of tournament.bracket) {
              for (const match of bracket.matches) {
                if (match.lichessUrl.includes(data.gameId)) {
                  matchInfo = {
                    player1: match.player1,
                    player2: match.player2,
                    result: data.state.status,
                    winner: match.winner
                  };
                  break;
                }
              }
              if (matchInfo) break;
            }
            
            if (matchInfo) {
              io.to(data.tournamentId).emit("match_finished", {
                gameId: data.gameId,
                ...matchInfo
              });
              console.log(`📢 Match finished event broadcasted for game ${data.gameId}`);
            }
          }
        }
      } catch (error) {
        console.error("❌ Error updating game state:", error);
      }
    });

    // Handle watching specific match
    socket.on("watch_match", (data: { gameId: string; tournamentId: string }) => {
      if (!data.gameId || !data.tournamentId) return;
      
      // Create a room specific to this match
      const matchRoom = `${data.tournamentId}:match:${data.gameId}`;
      socket.join(matchRoom);
      
      console.log(`👁️ User ${socket.id} watching match: ${data.gameId} in tournament: ${data.tournamentId}`);
      
      // Notify how many users are watching
      const roomSize = io.sockets.adapter.rooms.get(matchRoom)?.size || 0;
      io.to(matchRoom).emit("viewers_count", { count: roomSize });
      console.log(`👥 ${roomSize} viewers for match ${data.gameId}`);
    });

    // Handle disconnection
    socket.on("disconnect", () => {
      console.log(`🔴 User disconnected: ${socket.id}`);
      
      // Notify tournament room if user was identified and in a room
      if (currentUser && currentTournamentId) {
        socket.to(currentTournamentId).emit("user_left", {
          lichessId: currentUser.lichessId,
          timestamp: new Date()
        });
        console.log(`👋 Notified room ${currentTournamentId} that user ${currentUser.lichessId} left`);
      }
    });
  });

  return io;
};

/**
 * Get current active matches for a tournament
 */
async function getCurrentMatches(tournamentId: string) {
  try {
    const tournament = await TournamentModel.findById(tournamentId);
    if (!tournament) {
      console.error(`❌ Tournament ${tournamentId} not found when getting matches`);
      return [];
    }

    const currentBracket = tournament.bracket[tournament.currentStage];
    if (!currentBracket) {
      console.log(`ℹ️ No current bracket for tournament ${tournamentId}`);
      return [];
    }

    console.log(`🎮 Found ${currentBracket.matches.length} matches for tournament ${tournamentId}`);
    
    return currentBracket.matches.map(match => ({
      gameId: match.lichessUrl.split('/').pop()?.split('?')[0],
      player1: match.player1,
      player2: match.player2,
      lichessUrl: match.lichessUrl,
      result: match.result,
      winner: match.winner
    }));
  } catch (error) {
    console.error("❌ Error getting current matches:", error);
    return [];
  }
}

/**
 * Verify JWT token and extract user ID
 */
function verifyToken(token: string): string {
  try {
    if (!process.env.TOKEN_SECRET) {
      throw new Error("TOKEN_SECRET is not defined");
    }

    const payload = jwt.verify(token, process.env.TOKEN_SECRET);
    return (payload as any)._id;
  } catch (error) {
    throw new Error("Invalid token");
  }
}

/**
 * Get tournament stream page data (REST API endpoint)
 */
export const getTournamentStream = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    console.log(`📊 Tournament stream request for ID: ${id}`);

    if (!mongoose.Types.ObjectId.isValid(id)) {
      console.error(`❌ Invalid tournament ID format: ${id}`);
      return res.status(400).json({ error: "Invalid tournament ID" });
    }

    const tournament = await TournamentModel.findById(id);
    if (!tournament) {
      console.error(`❌ Tournament not found: ${id}`);
      return res.status(404).json({ error: "Tournament not found" });
    }

    console.log(`✅ Found tournament: ${tournament.tournamentName}`);

    const currentBracket =
      tournament.currentStage >= 0 &&
      tournament.bracket.length > tournament.currentStage
        ? tournament.bracket[tournament.currentStage]
        : null;

    const playerIds = tournament.playerIds || [];
    console.log(`👥 Getting info for ${playerIds.length} players`);

    const playersInfo = await Promise.all(
      playerIds.map(async (lichessId) => {
        try {
          const response = await fetch(`https://lichess.org/api/user/${lichessId}`);
          if (response.ok) {
            const data = await response.json();
            return {
              lichessId,
              username: data.username || lichessId,
              rating: data.perfs?.blitz?.rating || data.perfs?.rapid?.rating || 1500,
              title: data.title || null
            };
          }
          console.warn(`⚠️ Could not get player data from Lichess for ${lichessId}`);
          return { lichessId, username: lichessId, rating: 1500, title: null };
        } catch (error) {
          console.warn(`⚠️ Failed to fetch user data for ${lichessId}:`, error);
          return { lichessId, username: lichessId, rating: 1500, title: null };
        }
      })
    );

    const matches = currentBracket
      ? currentBracket.matches.map((match) => ({
          gameId: match.lichessUrl.split("/").pop()?.split("?")[0],
          player1: match.player1,
          player2: match.player2,
          lichessUrl: match.lichessUrl,
          result: match.result || "pending",
          winner: match.winner
        }))
      : [];

    console.log(`🎮 Returning ${matches.length} matches for the tournament`);

    // 🔧 תיקון TS: המרה מפורשת של _id ל־string
    const tournamentIdStr = (tournament._id as mongoose.Types.ObjectId).toString();

    const response = {
      tournament: {
        id: tournamentIdStr,
        name: tournament.tournamentName,
        status: tournament.status,
        currentStage: tournament.currentStage,
        bracketName: currentBracket?.name || "Tournament not started",
        maxPlayers: tournament.maxPlayers,
        entryFee: tournament.entryFee,
        prize: tournament.tournamentPrize
      },
      players: playersInfo,
      matches,
      chatEnabled: true
    };

    console.log(`📤 Sending tournament stream data for ${tournament.tournamentName}`);
    res.json(response);
  } catch (error) {
    console.error("❌ Error retrieving tournament stream data:", error);
    res.status(500).json({
      error: "Failed to retrieve tournament data",
      details: error instanceof Error ? error.message : String(error)
    });
  }
};


/**
 * Poll for Lichess game updates and broadcast to room (background job)
 */
export const startGamePolling = (io: SocketIOServer) => {
  const POLL_INTERVAL = 3500; // 30 שניות (הוגדל כדי להפחית עומס API)
  
  const pollActiveTournaments = async () => {
    try {
      console.log("🔄 התחלת מחזור סקירת משחקים");
      
      // בדוק תוצאות טורניר ועדכן במסד הנתונים
      await pollTournamentResults();
      
      // מצא טורנירים פעילים שוב כדי לקבל נתונים עדכניים
      // Import the proper type from your model file
      const tournaments = await TournamentModel.find({ status: "active" });
      
      // שדר עדכונים ללקוחות מחוברים עבור כל טורניר
      for (const tournament of tournaments) {
        // Use the fixed version with proper type casting
        const tournamentId = (tournament._id as mongoose.Types.ObjectId).toString();
        const roomExists = io.sockets.adapter.rooms.has(tournamentId);
        
        // שדר רק אם מישהו מאזין
        if (roomExists) {
          console.log(`📢 משדר עדכונים לחדר הטורניר: ${tournamentId}`);
          
          // קבל משחקים נוכחיים עם סטטוס עדכני
          if (tournament.currentStage >= 0 && tournament.bracket.length > tournament.currentStage) {
            const currentBracket = tournament.bracket[tournament.currentStage];
            
            if (currentBracket && currentBracket.matches) {
              for (const match of currentBracket.matches) {
                const gameId = match.lichessUrl.split('/').pop()?.split('?')[0];
                
                if (gameId) {
                  // שדר סטטוס משחק
                  io.to(tournamentId).emit("game_state_change", {
                    gameId,
                    state: {
                      status: match.result || "pending",
                      winner: match.winner ? (match.winner === match.player1 ? "white" : "black") : null
                    }
                  });
                  
                  // אם המשחק הסתיים, שדר אירוע match_finished
                  if (match.result && match.result !== "pending" && match.result !== "error") {
                    io.to(tournamentId).emit("match_finished", {
                      gameId,
                      player1: match.player1,
                      player2: match.player2,
                      result: match.result,
                      winner: match.winner
                    });
                  }
                }
              }
            }
          }
        }
      }
      
    } catch (error) {
      console.error("❌ שגיאה בסקירת טורניר:", error);
    }
    
    // תזמן את הסקירה הבאה
    setTimeout(pollActiveTournaments, POLL_INTERVAL);
  };
  
  // התחל בסקירה עם השהייה ראשונית כדי למנוע עומס מיידי
  setTimeout(pollActiveTournaments, 3500);
  console.log(`🔄 סקירת משחקים התחילה במרווחים של ${POLL_INTERVAL}ms`);
};

export default {
  initializeSocketServer,
  getTournamentStream,
  startGamePolling
};