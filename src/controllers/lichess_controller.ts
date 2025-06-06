import axios from "axios";
import { Request, Response } from "express";
import userModel from "../models/user_model";
import jwt, { SignOptions } from "jsonwebtoken";
import crypto from "crypto";
import dotenv from "dotenv";
import { askGeminiRaw } from "../api/GeminiApi";
import TournamentModel from "../models/tournament_model";
import { advanceTournamentRound } from "./tournament_logic"; // 💡 חשוב לייבא נכון
import mongoose from "mongoose";
import  { TournamentDocument } from "../models/tournament_model";

const getBracketName = (playerCount: number): string => {
  switch (playerCount) {
    case 2: return "Final";
    case 4: return "Semifinals";
    case 8: return "Quarterfinals";
    case 16: return "Round of 16";
    case 32: return "Round of 32";
    default: return `Round of ${playerCount}`;
  }
};



// הרחבת session כדי לאפשר אחסון של codeVerifier
declare module "express-session" {
  interface SessionData {
    codeVerifier?: string;
  }
}


interface ChallengeResponse {
  challenge: { id: string };
}

interface LichessChallengeResponse {
  id: string;
  challenge?: { id: string };  // ✅ אופציונלי
  urlWhite?: string;
  urlBlack?: string;
  url?: string;
}


interface LichessGameExport {
  winner?: "white" | "black";
  status?: string;
  players: {
    white?: { user?: { id: string; username?: string } };
    black?: { user?: { id: string; username?: string } };
  };
}

dotenv.config();
const frontendUrl = process.env.BASE_URL!;

const LICHESS_AUTHORIZE_URL = "https://lichess.org/oauth";
const LICHESS_TOKEN_URL = "https://lichess.org/api/token";
const LICHESS_ACCOUNT_URL = "https://lichess.org/api/account";

const clientId = process.env.LICHESS_CLIENT_ID!;
const redirectUri = process.env.LICHESS_REDIRECT_URI!;
const tokenSecret = process.env.TOKEN_SECRET!;
const tokenExpire = process.env.TOKEN_EXPIRE ?? "3d";

// פונקציה לפירוק משך זמן כמו "3d" לשניות
const parseDuration = (duration: string): number => {
  const units: { [key: string]: number } = {
    s: 1,
    m: 60,
    h: 3600,
    d: 86400,
  };
  const match = duration.match(/^(\d+)([smhd])$/);
  if (!match) throw new Error("Invalid duration format");
  return parseInt(match[1]) * units[match[2]];
};

// פונקציות PKCE
function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

interface LichessTokenResponse {
  access_token: string;
}

interface LichessUser {
  id: string;
  username: string;
  [key: string]: any;
}

// יצירת URL להפניית המשתמש להתחברות דרך Lichess
const loginWithLichess = (req: Request, res: Response) => {
  // יצירת code verifier ייחודי
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  // שמירת code verifier בסשן
  req.session.codeVerifier = codeVerifier;
  
  // הדפסה מפורטת לצורכי ניפוי שגיאות
  console.log("🔐 Generated code_verifier:", codeVerifier);
  console.log("🔑 Generated code_challenge:", codeChallenge);
  console.log("💾 Storing in session:", req.sessionID);
  
  // ודא ששמירת הסשן הסתיימה לפני ההפניה
  req.session.save((err) => {
    if (err) {
      console.error("❌ Error saving session:", err);
      return res.status(500).json({ 
        error: "Failed to save session",
        details: err?.message
      });
    }

    // הרכב את כתובת ה-URL להפניה
    const authUrl = `${LICHESS_AUTHORIZE_URL}?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}&scope=challenge:write%20board:play%20bot:play&code_challenge=${codeChallenge}&code_challenge_method=S256`;
    
    console.log("🔄 Redirecting to Lichess:", authUrl);
    
    // הפנה את המשתמש ל-Lichess
    res.redirect(authUrl);
  });
};

// פונקציית עזר לניסיונות חוזרים
async function fetchWithRetry(url: string, options: any, retries: number = 3) {
  let lastError;
  
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      console.log(`🔄 Fetch attempt ${attempt + 1}/${retries} to ${url}`);
      
      // נסה לבצע את הבקשה
      const fetchResult = await fetch(url, options);
      return fetchResult;
      
    } catch (error) {
      console.error(`❌ Attempt ${attempt + 1} failed:`, error);
      lastError = error;
      
      // המתנה בין ניסיונות (עם המתנה ארוכה יותר בכל ניסיון)
      if (attempt < retries - 1) {
        const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s...
        console.log(`⏱️ Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  // כל הניסיונות נכשלו
  throw lastError;
}

// callback מה-lichess
const lichessCallback = async (req: Request, res: Response): Promise<void> => {
  console.log("✅ Lichess callback reached");
  console.log("Request query:", req.query);
  console.log("Session ID:", req.sessionID);
  console.log("Session contents:", req.session);
  
  const code = req.query.code as string;
  const codeVerifier = req.session.codeVerifier;
  console.log("code_verifier (callback):", req.session.codeVerifier);

  if (!codeVerifier) {
    console.error("❌ Missing code_verifier from session");
    res.status(400).json({ error: "Missing code_verifier from session" });
    return;
  }

  if (!code) {
    console.error("❌ Missing authorization code from query");
    res.status(400).json({ error: "Missing authorization code" });
    return;
  }

  try {
    console.log("🔄 Attempting to exchange code for token...");
    
    // הגדרת בקשה עם זמן ארוך יותר וניסיונות חוזרים
    const tokenRes = await fetchWithRetry(
      LICHESS_TOKEN_URL,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          client_id: clientId,
          code_verifier: codeVerifier,
        }).toString(),
        // הגדלת זמן ההמתנה לתשובה
        timeout: 15000
      },
      3 // מספר ניסיונות חוזרים
    );
    
    if (!tokenRes.ok) {
      console.error(`❌ Lichess token endpoint returned ${tokenRes.status}: ${tokenRes.statusText}`);
      
      // במקרה של שגיאה, בדוק אם אפשר להחזיר תשובה יותר ספציפית
      if (tokenRes.status === 400) {
        const errorData = await tokenRes.text();
        res.status(400).json({ 
          error: "Lichess API error",
          details: errorData
        });
        return;
      }
      
      // במקרה אחר, החזר שגיאה כללית
      throw new Error(`Lichess token endpoint returned ${tokenRes.status}`);
    }
    
    const tokenData = await tokenRes.json() as { access_token: string };
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      console.error("❌ No access token in response");
      throw new Error("No access token in response");
    }
    
    console.log("✅ Received access token from Lichess");
    
    try {
      console.log("🔄 Fetching Lichess user information...");
      
      const userInfoRes = await fetch(LICHESS_ACCOUNT_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      
      if (!userInfoRes.ok) {
        console.error(`❌ Lichess API account endpoint returned ${userInfoRes.status}`);
        throw new Error(`Lichess API account endpoint returned ${userInfoRes.status}`);
      }
      
      const lichessUser = await userInfoRes.json() as LichessUser;
      const lichessId = lichessUser.id;
      
      console.log(`✅ Fetched user info: ${lichessId}`);
      
      // מציאת המשתמש במסד הנתונים או יצירת אחד חדש
      let user = await userModel.findOne({ lichessId });
      
      if (!user) {
        console.log(`🆕 Creating new user with lichessId: ${lichessId}`);
        user = await userModel.create({
          lichessId,
          lichessAccessToken: accessToken,
          balance: 0,
        });
      }
       else {
        console.log(`✏️ Updating existing user: ${lichessId}`);
        user.lichessAccessToken = accessToken;
        await user.save();
      }
      
      // יצירת טוקן JWT
      const token = jwt.sign({ _id: user._id }, tokenSecret, {
        expiresIn: parseDuration(tokenExpire),
      } as SignOptions);
      
      console.log(`✅ Successfully processed login for user: ${lichessId}`);
      console.log(`🔄 Redirecting to: ${frontendUrl}/login?token=${token}&userId=${user._id}&lichessId=${user.lichessId}`);
      
      res.redirect(
        `${frontendUrl}/login?token=${token}&userId=${user._id}&lichessId=${user.lichessId}`
      );
      return;
      
    } catch (userError) {
      console.error("❌ Error during user info fetch:", userError);
      res.status(500).json({ 
        error: "Failed to fetch user info from Lichess",
        details: userError instanceof Error ? userError.message : "Unknown error"
      });
      return;
    }
    
  } catch (err) {
    console.error("❌ Error during Lichess OAuth flow:", err);
    
    // שגיאה ידידותית למשתמש
    res.status(500).json({ 
      error: "Lichess login failed",
      message: "Failed to connect with Lichess. Please try again later.",
      details: err instanceof Error ? err.message : "Unknown error" 
    });
    return;
  }
};

const autoMatchWithAI = async (req: Request, res: Response) => {
  try {
    const users = await userModel.find({ lichessId: { $exists: true } });

    const enrichedUsers = await Promise.all(
      users.map(async (user) => {
        try {
          const res = await axios.get(
            `https://lichess.org/api/user/${user.lichessId}`
          );
          const data = res.data as LichessUser;

          const userData = {
            _id: user._id.toString(),
            lichessId: user.lichessId,
            username: data.username,
            blitzRating: data?.perfs?.blitz?.rating ?? 1500,
            bulletRating: data?.perfs?.bullet?.rating ?? 1500,
            rapidRating: data?.perfs?.rapid?.rating ?? 1500,
            totalGames: data.count?.all ?? 0,
          };

          // ✅ הדפסת הנתונים של כל משתמש
          console.log("🎯 Lichess User Data:", userData);

          return userData;
        } catch (err) {
          console.warn("`⚠️ Failed to fetch data for ${user.lichessId}`", err);
          return null;
        }
      })
    );

    const players = enrichedUsers.filter((u) => u !== null);

    const prompt = `
    Here is a list of chess players from Lichess, each with their blitz, bullet, rapid ratings, and total number of games:
    
    ${JSON.stringify(players, null, 2)}
    
    Please choose two players who would be a balanced and competitive match based on their ratings and total game experience.
    
    Return the result in the following JSON format only:
    {
      "player1": "<lichessId of player 1>",
      "player2": "<lichessId of player 2>"
    }
      Only return the JSON. No explanation!
      Do NOT include any markdown formatting (like \` or: any \`json). Only return plain JSON.
    `;

    const aiResponse = await askGeminiRaw(prompt);

    const cleaned = cleanJsonFromAI(aiResponse);

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error("❌ Failed to parse Gemini response:", parseErr);
      console.error("📦 Raw response from AI:", aiResponse);
      res.status(500).json({ error: "Invalid AI response format." });
    }

    if (parsed.player1 && parsed.player2) {
      res.status(200).json({
        message: "AI Match found",
        match: parsed,
      });
    } else {
      res.status(404).json({ message: "AI could not find a match." });
    }
  } catch (err) {
    console.error("AI AutoMatch Error", err);
    res.status(500).send("Server error");
  }
};

function cleanJsonFromAI(raw: string | null): string {
  return (raw || "").replace(/json/g, "").replace(/ /g, "").trim();
}

export const createTournament = async (req: Request, res: Response) => {
  const {
    createdBy,
    playerIds,
    maxPlayers,
    tournamentName,
    visibility,
    entryFee,
  } = req.body;

  try {
    const creator = await userModel.findById(createdBy);

    if (!creator) {
      console.warn("❌ Creator not found:", createdBy);
      return res.status(403).json({ error: "User not found" });
    }

    if (!creator.lichessAccessToken) {
      console.warn("❌ Creator missing Lichess access token:", creator._id);
      return res
        .status(403)
        .json({ error: "User not authenticated with Lichess" });
    }

    // 💰 בדיקת balance של היוצר
    if ((creator.balance ?? 0) < entryFee) {
      return res.status(403).json({
        error: "Insufficient balance to create the tournament",
        currentBalance: creator.balance ?? 0,
        required: entryFee,
      });
    }

    // (אופציונלי) - עדכון balance בשרת רק כשהטורניר מתחיל (בשלב ה-start), אז פה לא מחייבים בפועל

    // 🎯 הבאת רייטינג מ-Lichess
    const userRes = await fetch(
      `https://lichess.org/api/user/${creator.lichessId}`
    );
    if (!userRes.ok) {
      console.warn(
        "⚠️ Failed to fetch user data from Lichess:",
        userRes.statusText
      );
    }

    const userData = await userRes.json();
    const blitzRating = userData?.perfs?.blitz?.rating ?? 1500;

    // קביעת טווח דירוג
    let rankRange = { label: "Beginner", min: 0, max: 1200 };
    if (blitzRating >= 1200 && blitzRating < 1400) {
      rankRange = { label: "Intermediate", min: 1200, max: 1400 };
    } else if (blitzRating >= 1400 && blitzRating < 1700) {
      rankRange = { label: "Pro", min: 1400, max: 1700 };
    } else if (blitzRating >= 1700) {
      rankRange = { label: "Elite", min: 1700, max: 2200 };
    }

    // חישוב סכום הפרס
    const tournamentPrize = entryFee * maxPlayers;

    // ✅ יצירת הטורניר
    const tournament = await TournamentModel.create({
      tournamentName,
      createdBy,
      playerIds,
      maxPlayers,
      visibility,
      entryFee,
      tournamentPrize,
      rated: true,
      rounds: [],
      winner: null,
      status: "active",
      rankRange,
    });

    res.status(201).json({
      message: "Tournament created",
      tournament,
      rankRange,
      lobbyUrl: `${process.env.BASE_URL}/lobby/${tournament._id}`,
    });
  } catch (error) {
    console.error("❌ Error creating tournament:", error);
    res.status(500).json({ error: "Internal server error." });
  }
};



const joinLobby = async (req: Request, res: Response) => {
  const { username } = req.body;
  const { id } = req.params;

  if (!username) return res.status(400).json({ error: "Missing username" });

  try {
    const tournament = await TournamentModel.findById(id);
    if (!tournament) {
      return res.status(404).json({ error: "Tournament not found" });
    }

    const user = await userModel.findOne({ lichessId: username });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if ((user.balance ?? 0) < tournament.entryFee) {
      return res.status(403).json({ error: "Insufficient balance to join tournament" });
    }

    if (!tournament.playerIds.includes(username)) {
      tournament.playerIds.push(username);
      await tournament.save();
    
      // 👇 Check if lobby just became full
      if (tournament.playerIds.length === tournament.maxPlayers) {
        const io = req.app.get("socketio"); // 🔌 Get the socket instance
    
        // Assume the creator is the first player
        const creator = tournament.playerIds[0]; 
    
        // Emit to the creator only
        io.to(creator).emit("lobbyFull", {
          tournamentId: tournament._id,
          tournamentName: tournament.tournamentName,
        });
    
        console.log(`📢 Emitted 'lobbyFull' to ${creator}`);
      }
    }

    res.json({ message: "Joined", tournament });
  } catch (err) {
    console.error("❌ joinLobby error:", err);
    res.status(500).json({ error: "Server error" });
  }
};

const getTournamentById = async (req: Request, res: Response) => {
  try {
    const tournament = await TournamentModel.findById(req.params.id);
    if (!tournament) {
      return res.status(404).json({ error: "Tournament not found" });
    }
    res.json(tournament);
  } catch (err) {
    console.error("❌ Failed to get tournament:", err);
    res.status(500).json({ error: "Server error" });
  }
};

// פונקציה זו בודקת אם הטוקן תקף
async function validateLichessToken(token: string): Promise<boolean> {
  try {
    const response = await fetch(LICHESS_ACCOUNT_URL, {
      headers: {
        Authorization: `Bearer ${token}`
      },
    });
    
    return response.ok;
  } catch (error) {
    console.error("❌ Token validation failed:", error);
    return false;
  }
}




// תקן את השגיאות של טיפוס בפונקציית startTournament
const startTournament = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    console.log(`🔄 התחלת טורניר ${id}`);

    const tournament = await TournamentModel.findById(id);
    if (!tournament) {
      return res.status(404).json({ error: "Tournament not found" });
    }

    if (tournament.bracket.length > 0) {
      return res.status(400).json({
        error: "Tournament already started",
        bracket: tournament.bracket,
      });
    }

    if (tournament.playerIds.length !== tournament.maxPlayers) {
      return res.status(400).json({
        error: "Lobby not full",
        current: tournament.playerIds.length,
        required: tournament.maxPlayers,
      });
    }

    const creator = await userModel.findById(tournament.createdBy);
    if (!creator || !creator.lichessAccessToken) {
      return res.status(403).json({ error: "Creator not authorized with Lichess" });
    }

    // ✅ בדיקה וחיוב של כל שחקן
    const entryFee = tournament.entryFee ?? 0;
    for (const lichessId of tournament.playerIds) {
      const user = await userModel.findOne({ lichessId });
      if (!user) {
        return res.status(404).json({ error: `User ${lichessId} not found` });
      }
      if ((user.balance ?? 0) < entryFee) {
        return res.status(403).json({
          error: `User ${lichessId} does not have enough balance to join this tournament`,
        });
      }
    }

    for (const lichessId of tournament.playerIds) {
  const user = await userModel.findOne({ lichessId });
  if (user) {
    user.balance = (user.balance ?? 0) - entryFee;
    await user.save();
  }
}


    // 👥 הכנה לשיבוץ שחקנים
    const validPlayers = tournament.playerIds.filter(Boolean);
    const shuffled = validPlayers.sort(() => 0.5 - Math.random());
    const matches = [];

    let byePlayer = null;
    if (shuffled.length % 2 !== 0) {
      byePlayer = shuffled.pop();
      if (byePlayer) {
        tournament.advancingPlayers.push(byePlayer);
      }
    }

    // 🎯 יצירת משחקים
    for (let i = 0; i < shuffled.length; i += 2) {
      const p1Id = shuffled[i];
      const p2Id = shuffled[i + 1];

      try {
        const challengeRes = await axios.post<LichessChallengeResponse>(
          "https://lichess.org/api/challenge/open",
          {
            rated: tournament.rated,
            clock: { limit: 300, increment: 0 },
            variant: "standard",
          },
          {
            headers: {
              Authorization: `Bearer ${creator.lichessAccessToken}`,
              Accept: "application/json",
            },
            timeout: 10000,
          }
        );

        const responseData = challengeRes.data;
        const gameId = responseData.id || (responseData as any).challenge?.id;
        if (!gameId) {
          console.error("Missing game ID in response:", responseData);
          throw new Error("Missing game ID in challenge response");
        }

        const gameUrl = `https://lichess.org/${gameId}`;
        const whiteUrl = responseData.urlWhite || `${gameUrl}?color=white`;
        const blackUrl = responseData.urlBlack || `${gameUrl}?color=black`;

        matches.push({
          player1: p1Id,
          player2: p2Id,
          lichessUrl: gameUrl,
          whiteUrl: whiteUrl,
          blackUrl: blackUrl,
          result: "pending",
          winner: null,
        });

        console.log(`📝 Match created: ${p1Id} vs ${p2Id} (game: ${gameUrl})`);
        await new Promise((resolve) => setTimeout(resolve, 1500));
      } catch (err) {
        console.error(`❌ Error creating match for ${p1Id} vs ${p2Id}:`, err);
        matches.push({
          player1: p1Id,
          player2: p2Id,
          lichessUrl: `https://lichess.org/error-placeholder-${Date.now()}`,
          whiteUrl: "#",
          blackUrl: "#",
          result: "error",
          winner: null,
        });
      }
    }

    const bracketName = getBracketName(shuffled.length + (byePlayer ? 1 : 0));

    const updatedTournament = await TournamentModel.findByIdAndUpdate(
      tournament._id,
      {
        $set: {
          bracket: [
            {
              name: bracketName,
              matches,
              startTime: new Date(),
            },
          ],
          currentStage: 0,
          advancingPlayers: byePlayer ? [byePlayer] : [],
        },
      },
      { new: true }
    );

    return res.status(200).json({
      message: "Tournament started successfully",
      matches,
      byePlayer,
      tournament: updatedTournament,
    });
  } catch (err) {
    console.error("❌ Error starting tournament:", err);
    return res.status(500).json({
      error: "Internal server error",
      details: err instanceof Error ? err.message : "Unknown error",
    });
  }
};










const updateMatchResultByLichessUrl = async (
  req: Request,
  res: Response
) => {
  try {
    console.log("🔍 Request received to update match:", req.body);
    const { lichessUrl, winner, status } = req.body;

    if (!lichessUrl) {
      console.log("❌ Missing lichessUrl in request body");
      return res.status(400).json({ error: "Missing lichessUrl" });
    }

    const gameId = lichessUrl.split('/').pop()?.split('?')[0];
    if (!gameId) {
      return res.status(400).json({ error: "Invalid lichessUrl format" });
    }

    const tournament = await TournamentModel.findOne({
      $or: [
        { "bracket.matches.lichessUrl": lichessUrl },
        { "bracket.matches.lichessUrl": { $regex: gameId } }
      ]
    });

    if (!tournament) {
      console.log(`❌ No tournament found with game ID: ${gameId}`);
      return res.status(404).json({ error: "Tournament not found for this match" });
    }

    console.log(`✅ Found tournament: ${tournament._id}`);

    let updated = false;
    let winningPlayerId: string | null = null;

    for (let bracketIndex = 0; bracketIndex < tournament.bracket.length; bracketIndex++) {
      const bracket = tournament.bracket[bracketIndex];

      for (let matchIndex = 0; matchIndex < bracket.matches.length; matchIndex++) {
        const match = bracket.matches[matchIndex];
        const currentGameId = match.lichessUrl.split('/').pop()?.split('?')[0];

        if (match.lichessUrl === lichessUrl || currentGameId === gameId) {
          console.log(`✅ Found matching game in bracket ${bracketIndex}, match ${matchIndex}`);

          if (winner === "white") {
            winningPlayerId = match.player1;
          } else if (winner === "black") {
            winningPlayerId = match.player2;
          } else {
            winningPlayerId = "draw";
          }

          const updatePath = `bracket.${bracketIndex}.matches.${matchIndex}`;
          const updateObj: Record<string, any> = {};
          updateObj[`${updatePath}.result`] = status || "completed";
          updateObj[`${updatePath}.winner`] = winningPlayerId;

          await TournamentModel.updateOne(
            { _id: tournament._id },
            { $set: updateObj }
          );

          console.log(`✅ Updated match result to status: ${status}, winner: ${winningPlayerId}`);
          updated = true;

          // advancing
          if (
            bracketIndex === tournament.currentStage &&
            winningPlayerId !== "draw" &&
            winningPlayerId !== null &&
            !tournament.advancingPlayers.includes(winningPlayerId)
          ) {
            tournament.advancingPlayers.push(winningPlayerId);
            await tournament.save();
            console.log(`🏁 ${winningPlayerId} advanced to next round`);

            if (tournament.status === "completed") {
              console.log("🏁 Tournament is already completed. Skipping advancement.");
            } else {
              try {
                await advanceTournamentRound((tournament._id as mongoose.Types.ObjectId).toString());
              } catch (advanceError) {
                console.error("❌ Error advancing tournament:", advanceError);
              }
            }
          }

          break;
        }
      }

      if (updated) break;
    }

    if (!updated) {
      console.log("⚠️ Match found in tournament but couldn't be updated");
      return res.status(404).json({ error: "Match not found in tournament" });
    }

    return res.status(200).json({
      message: "Match result updated successfully",
      winner: winningPlayerId,
      status: status,
    });
  } catch (err) {
    console.error("❌ Error updating match result:", err);
    return res.status(500).json({
      error: "Internal server error",
      details: err instanceof Error ? err.message : "Unknown error",
    });
  }
};









export const getGameResult = async (req: Request, res: Response) => {
  const { gameId } = req.params;

  try {
    // Fetch game result from Lichess
    const response = await axios.get<LichessGameExport>(
      `https://lichess.org/api/games/export/${gameId}`,
      {
        headers: { Accept: "application/json" },
        params: { moves: false, clocks: false, evals: false },
      }
    );

    const data = response.data;
    const winnerColor = data.winner; // "white" or "black"
    const whitePlayer = data.players.white?.user;
    const blackPlayer = data.players.black?.user;

    let winnerName = "Draw"; // Default to "Draw" if no winner is found
    if (winnerColor === "white" && whitePlayer) {
      winnerName = whitePlayer.username || "Unknown Player";
    } else if (winnerColor === "black" && blackPlayer) {
      winnerName = blackPlayer.username || "Unknown Player";
    }

    const status =
      data.status === "resign" ? "One player resigned" : data.status;

    console.log("winner: ", winnerName);

    // Send the result with the winner and status
    return res.json({
      winner: winnerName,
      status: status,
      whitePlayer: whitePlayer?.username,
      blackPlayer: blackPlayer?.username,
    });
  } catch (error) {
    console.error("Failed to fetch game result:", error);
    return res.status(500).json({ error: "Failed to fetch game result" });
  }
};



export const analyzePlayerStyle = async (req: Request, res: Response) => {
  const { username } = req.params;

  if (!username) {
    return res.status(400).json({ error: "Missing username" });
  }

  try {
    // נביא את המשחקים של השחקן מה-lichess
    const response = await fetch(`https://lichess.org/api/games/user/${username}?max=10&opening=true`, {
      headers: {
        Accept: 'application/x-ndjson',
      },
    });

    const text = await response.text();

    if (!text || text.trim().length === 0) {
      return res.status(404).json({ error: "No games found for user" });
    }

    // המשחקים מחולקים לפי שורות NDJSON
    const games = text
      .split('\n')
      .filter(line => line.trim() !== "")
      .map(line => JSON.parse(line));

    const formattedGames = games.map(g => {
      const result = g.winner ? `${g.winner} won` : 'draw';
      return `- Opponent: ${g.players.white?.user?.name} vs ${g.players.black?.user?.name} | Result: ${result} | Opening: ${g.opening?.name ?? 'N/A'}`;
    }).join('\n');

    const prompt = `
You are a chess expert AI. Given the following recent games of a Lichess player, describe their overall play style in up to 7 concise sentences.

Games:
${formattedGames}

Describe their strengths, weaknesses, tendencies (e.g. aggressive openings, frequent use of tactics, endgame strength), and your impression of their level.
Be fluent and natural in tone. Output in plain English only.
`;

    const responseFromGemini = await askGeminiRaw(prompt);

    if (!responseFromGemini) {
      return res.status(500).json({ error: "AI failed to generate analysis" });
    }

    return res.status(200).json({
      username,
      analysis: responseFromGemini.trim(),
    });

  } catch (err) {
    console.error("❌ Error in analyzePlayerStyle:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};



export const analyzeSingleGame = async (req: Request, res: Response) => {
  const { gameId, username } = req.params;

  if (!gameId || !username) {
    return res.status(400).json({ error: "Missing gameId or username" });
  }

  try {
    const gameData = await getGameDataWithPgn(gameId, username);

    const prompt = `
You are a chess expert AI. Analyze the following PGN game played by ${username}, who played as ${gameData.playerColor} and ${gameData.gameResult}.

Opponent: ${gameData.opponent} (${gameData.opponentRating})
Opening: ${gameData.opening}
Time Control: ${gameData.timeControl}

Here is the complete PGN:
${gameData.pgn}

Please write a short analysis of the player's performance, highlighting 2-3 specific strengths or areas for improvement.
Use clear language. Avoid unnecessary fluff.
`;

    const aiResponse = await askGeminiRaw(prompt);

    if (!aiResponse) {
      return res.status(500).json({ error: "AI failed to respond" });
    }

    return res.status(200).json({
      username,
      gameId: gameData.cleanGameId,
      analysis: aiResponse.trim(),
    });
  } catch (err) {
    console.error("❌ analyzeSingleGame failed:", err);
    return res.status(500).json({
      error: "Failed to analyze game",
      details: err instanceof Error ? err.message : "Unknown error",
    });
  }
};





export const detectCheating = async (req: Request, res: Response) => {
  const { gameId, username } = req.params;

  if (!gameId || !username) {
    return res.status(400).json({ error: "Missing gameId or username" });
  }

  try {
    // ניקוי מזהה המשחק
    const cleanGameId = gameId.split('/').pop()?.split('?')[0] || gameId;
    
    console.log(`🔍 בדיקת רמאות למשחק: ${cleanGameId} עבור שחקן: ${username}`);
    
    // נמצא את המשתמש ב-DB כדי לקבל את הטוקן שלו
    const playerUser = await userModel.findOne({ lichessId: username });
    console.log(`🔑 משתמש נמצא: ${playerUser ? "כן" : "לא"}, יש טוקן: ${playerUser?.lichessAccessToken ? "כן" : "לא"}`);
    
    // נסה למצוא את היריב גם כן (למקרה שאין לנו את הטוקן של השחקן)
    let opponentToken = null;
    if (!playerUser?.lichessAccessToken) {
      // בדיקת מי היריב
      const gameInfo = await TournamentModel.findOne({ "bracket.matches.lichessUrl": { $regex: cleanGameId } });
      if (gameInfo) {
        const matchInfo = gameInfo.bracket.flatMap(b => b.matches).find(m => m.lichessUrl.includes(cleanGameId));
        if (matchInfo) {
          const opponentId = matchInfo.player1 === username ? matchInfo.player2 : matchInfo.player1;
          const opponentUser = await userModel.findOne({ lichessId: opponentId });
          opponentToken = opponentUser?.lichessAccessToken;
          console.log(`🔎 נמצא יריב: ${opponentId}, יש טוקן: ${opponentToken ? "כן" : "לא"}`);
        }
      }
    }
    
    // משתמשים ב-API הנכון להורדת PGN
    const lichessApiUrl = `https://lichess.org/game/export/${cleanGameId}`;
    
    // יצירת AbortController לקביעת timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500); // 15 שניות timeout
    
    // בחירת הטוקן הטוב ביותר שיש לנו
    const authToken = playerUser?.lichessAccessToken || opponentToken || process.env.LICHESS_PERSONAL_TOKEN;
    
    // הגדרת אפשרויות הבקשה
    const fetchOptions: RequestInit = {
      headers: {
        Accept: "application/x-chess-pgn", // מבקש PGN במקום JSON
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
      },
      signal: controller.signal
    };
    
    console.log(`🔄 מנסה לקבל PGN מליצ'ס (עם טוקן: ${authToken ? "כן" : "לא"})`);
    const response = await fetch(lichessApiUrl, fetchOptions);
    // ניקוי הטיימר לאחר קבלת תשובה
    clearTimeout(timeoutId);
    
    console.log(`📊 תשובה מליצ'ס: ${response.status}`);
    
    if (!response.ok) {
      // אם נכשל עם טוקן, ננסה שוב בלי טוקן
      if (authToken && response.status === 401) {
        console.log(`🔄 ניסיון חוזר ללא טוקן`);
        const noAuthOptions: RequestInit = {
          headers: {
            Accept: "application/x-chess-pgn"
          },
          signal: controller.signal
        };
        
        const retryResponse = await fetch(lichessApiUrl, noAuthOptions);
        if (retryResponse.ok) {
          console.log(`✅ הניסיון החוזר ללא טוקן הצליח!`);
          const pgn = await retryResponse.text();
          return processPgn(pgn, cleanGameId, username, res);
        }
      }
      
      const errorText = await response.text();
      console.log(`❌ שגיאה בתשובה מהשרת: ${errorText}`);
      return res.status(404).json({
        error: "המשחק לא נמצא או לא זמין דרך ה-API (פרטי או מזהה לא תקין)",
      });
    }
    
    // קבלת ה-PGN כטקסט
    const pgn = await response.text();
    console.log("PGN received:", pgn.substring(0, 200) + "...");
    
    return processPgn(pgn, cleanGameId, username, res);
    
  } catch (err) {
    console.error("❌ שגיאה בזיהוי רמאות:", err);
    return res.status(500).json({ 
      error: "שגיאה פנימית בניתוח המשחק",
      details: err instanceof Error ? err.message : "שגיאה לא ידועה"
    });
  }
};

async function processPgn(pgn: string, cleanGameId: string, username: string, res: Response) {
  try {
    // חילוץ מידע מה-PGN
    const headers: Record<string, string> = {};
    const headerRegex = /\[(.*?)\s"(.*?)"\]/g;
    let match;
    while ((match = headerRegex.exec(pgn)) !== null) {
      headers[match[1]] = match[2];
    }
    
    // חילוץ מהלכים
    const movesText = pgn.split(/\d+\./).slice(1).join(' ');
    console.log("Extracted moves:", movesText.substring(0, 100) + "...");
    
    // מידע על השחקנים
    const whiteName = headers["White"] || "";
    const blackName = headers["Black"] || "";
    const whiteElo = headers["WhiteElo"] || "";
    const blackElo = headers["BlackElo"] || "";
    const opening = headers["Opening"] || "";
    const timeControl = headers["TimeControl"] || "";
    const result = headers["Result"] || "";
    
    console.log(`🔎 מחפש שחקן: ${username}`);
    console.log(`⚪ שחקן לבן: ${whiteName}`);
    console.log(`⚫ שחקן שחור: ${blackName}`);
    
    const lowerUsername = username.toLowerCase();
    
    const playerColor = 
      whiteName.toLowerCase() === lowerUsername ? "white" :
      blackName.toLowerCase() === lowerUsername ? "black" : 
      "unknown";
    
    console.log(`🎯 זיהוי צבע השחקן: ${playerColor}`);
    
    if (playerColor === "unknown") {
      return res.status(404).json({
        error: "השחקן לא נמצא במשחק זה"
      });
    }

    // התוצאה - ניצחון, הפסד או תיקו
    const gameResult = 
      result === "1-0" ? (playerColor === "white" ? "won" : "lost") :
      result === "0-1" ? (playerColor === "black" ? "won" : "lost") :
      "draw";

    // זיהוי היריב
    const opponentName = playerColor === "white" ? blackName : whiteName;
    
    // חילוץ ה-ELO של השחקנים
    const playerRating = playerColor === "white" ? whiteElo : blackElo;
    const opponentRating = playerColor === "white" ? blackElo : whiteElo;
    
    console.log(`📊 תוצאת המשחק עבור ${username}: ${gameResult}`);

    // פרומפט ל-Gemini - באנגלית
    const prompt = `
You are a chess anti-cheating expert. Analyze this Lichess game to determine if the player "${username}" (who played as ${playerColor}) used computer engine assistance.

Game ID: ${cleanGameId}
Player: ${username} (rating: ${playerRating || 'unknown'})
Opponent: ${opponentName} (rating: ${opponentRating || 'unknown'})
Opening: ${opening || "N/A"}
Time control: ${timeControl || 'unknown'}

Complete game moves (PGN):
${pgn}

Analyze the game and determine if the player's moves show signs of potential engine use. Look for:

1. Perfect or near-perfect play in complex positions
2. Consistent finding of only moves or difficult tactical sequences
3. Play that's inconsistent with the player's rating level
4. Unusual time usage patterns
5. Non-human move selection patterns

Return your analysis as a JSON with these exact fields:
{
  "suspiciousPlay": true/false,
  "confidence": 0-100,
  "analysis": "detailed explanation of your findings",
  "engineSimilarity": "description of how similar the play is to engine play"
}

Only return the JSON with no additional text, markdown formatting, or backticks.
`;

    console.log("🤖 שולח נתונים ל-Gemini לניתוח רמאות");
    const aiResponse = await askGeminiRaw(prompt);

    if (!aiResponse) {
      return res.status(500).json({ error: "ה-AI נכשל בניתוח המשחק" });
    }

    // עיבוד התשובה מ-Gemini
    let parsedResponse;
    try {
      // ניקוי התשובה במקרה שהיא כוללת תגי markdown
      const cleanedResponse = aiResponse
        .replace(/```json/g, '')
        .replace(/```/g, '')
        .trim();
        
      parsedResponse = JSON.parse(cleanedResponse);
      
      // אם התגלתה רמאות, שמור את המידע במסד הנתונים
      if (parsedResponse.suspiciousPlay === true) {
        await saveCheatingDetection(username, cleanGameId, parsedResponse);
      }
      
    } catch (parseError) {
      console.error("❌ נכשל בפירוק תשובת Gemini:", parseError);
      console.log("תשובת AI גולמית:", aiResponse);
      
      return res.status(500).json({ 
        error: "נכשל בפירוק ניתוח ה-AI",
        rawResponse: aiResponse
      });
    }

    // הכנת התוצאה הסופית
    return res.status(200).json({
      username,
      gameId: cleanGameId,
      suspiciousPlay: parsedResponse.suspiciousPlay,
      confidence: parsedResponse.confidence,
      analysis: parsedResponse.analysis,
      engineSimilarity: parsedResponse.engineSimilarity
    });
  } catch (err) {
    console.error("❌ שגיאה בעיבוד ה-PGN:", err);
    return res.status(500).json({ 
      error: "שגיאה פנימית בעיבוד נתוני המשחק",
      details: err instanceof Error ? err.message : "שגיאה לא ידועה"
    });
  }
}

// פונקציה נפרדת לשמירת מידע על רמאות שהתגלתה
async function saveCheatingDetection(username: string, gameId: string, detectionResult: any) {
  try {
    // מציאת המשתמש במונגו
    const user = await userModel.findOne({ lichessId: username });
    
    if (!user) {
      console.log(`⚠️ לא ניתן לשמור מידע על רמאות: משתמש ${username} לא נמצא במסד הנתונים`);
      return;
    }
    
    // הוספת המידע על הרמאות לרשימת החשדות של המשתמש
    if (!user.cheatingDetections) {
      user.cheatingDetections = [];
    }
    
    user.cheatingDetections.push({
      gameId,
      timestamp: new Date(),
      confidence: detectionResult.confidence,
      analysis: detectionResult.analysis
    });
    
    // שמירת השינויים
    await user.save();
    
    console.log(`✅ נשמר מידע על חשד לרמאות עבור משתמש ${username} במשחק ${gameId}`);
  } catch (error) {
    console.error("❌ שגיאה בשמירת מידע על רמאות:", error);
  }
}

export const getGameDataWithPgn = async (gameId: string, username: string) => {
  console.log(`🔍 התחלת getGameDataWithPgn עבור משחק ${gameId} ושחקן ${username}`);
  
  const cleanGameId = gameId.split('/').pop()?.split('?')[0] || gameId;
  console.log(`🧹 מזהה משחק מנוקה: ${cleanGameId}`);

  // First try to find the user to get their personal token
  const playerUser = await userModel.findOne({ lichessId: username });
  console.log(`👤 נמצא משתמש: ${playerUser ? 'כן' : 'לא'}`);
  
  const personalToken = playerUser?.lichessAccessToken;
  const envToken = process.env.LICHESS_PERSONAL_TOKEN;
  console.log(`🔑 טוקן משתמש: ${personalToken ? 'זמין' : 'לא זמין'}`);
  console.log(`🔑 טוקן סביבה: ${envToken ? 'זמין' : 'לא זמין'}`);
  
  const authToken = personalToken || envToken;
  
  // Try with authentication first
  let response;
  console.log(`🔄 מנסה לקבל נתונים מ-Lichess...`);
  
  try {
    if (authToken) {
      console.log(`🔒 מנסה עם אימות`);
      response = await fetch(`https://lichess.org/game/export/${cleanGameId}`, {
        headers: {
          Accept: "application/x-chess-pgn",
          Authorization: `Bearer ${authToken}`,
        },
      });
      
      console.log(`📊 סטטוס תשובה: ${response.status}`);
      
      // If auth fails, try without token
      if (response.status === 401) {
        console.log(`⚠️ אימות נכשל, מנסה ללא טוקן`);
        response = await fetch(`https://lichess.org/game/export/${cleanGameId}`, {
          headers: {
            Accept: "application/x-chess-pgn",
          },
        });
        console.log(`📊 סטטוס תשובה (ללא אימות): ${response.status}`);
      }
    } else {
      // No token available, try unauthenticated request
      console.log(`⚠️ אין טוקן זמין, מנסה ללא אימות`);
      response = await fetch(`https://lichess.org/game/export/${cleanGameId}`, {
        headers: {
          Accept: "application/x-chess-pgn",
        },
      });
      console.log(`📊 סטטוס תשובה (ללא אימות): ${response.status}`);
    }
  } catch (error: unknown) {
    // בדיקה אם error הוא מסוג Error
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    console.error(`❌ שגיאה בקריאת ה-API:`, error);
    throw new Error(`Failed to connect to Lichess API: ${errorMessage}`);
  }

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`❌ תשובה לא תקינה מ-API: ${response.status}, ${errorText}`);
    throw new Error(`Failed to fetch PGN: ${errorText}`);
  }

  const pgn = await response.text();
  console.log(`✅ התקבל PGN באורך ${pgn.length} תווים`);
  console.log(`📝 PGN המלא:\n${pgn}`);

  // חילוץ מידע
  const headers: Record<string, string> = {};
  const headerRegex = /\[(.*?)\s"(.*?)"\]/g;
  let match;
  while ((match = headerRegex.exec(pgn)) !== null) {
    headers[match[1]] = match[2];
  }
  console.log(`📋 כותרות PGN:`, headers);

  // חילוץ מהלכים
  const movesText = pgn.split(/\n\n/)[1] || "";
  console.log(`♟️ מהלכי המשחק:\n${movesText}`);

  const white = headers["White"]?.toLowerCase() || "";
  const black = headers["Black"]?.toLowerCase() || "";
  const playerColor =
    username.toLowerCase() === white ? "white" :
    username.toLowerCase() === black ? "black" :
    "unknown";

  console.log(`♟️ צבע השחקן זוהה: ${playerColor}`);

  if (playerColor === "unknown") {
    console.error(`❌ השחקן ${username} לא נמצא במשחק`);
    throw new Error(`Player ${username} not found in game`);
  }

  const resultStr = headers["Result"];
  const gameResult =
    resultStr === "1-0" ? (playerColor === "white" ? "won" : "lost") :
    resultStr === "0-1" ? (playerColor === "black" ? "won" : "lost") :
    "draw";

  console.log(`🏁 תוצאת המשחק: ${gameResult}`);
  
  const result = {
    cleanGameId,
    pgn,
    playerColor,
    gameResult,
    opponent: playerColor === "white" ? headers["Black"] : headers["White"],
    playerRating: playerColor === "white" ? headers["WhiteElo"] : headers["BlackElo"],
    opponentRating: playerColor === "white" ? headers["BlackElo"] : headers["WhiteElo"],
    opening: headers["Opening"] || "N/A",
    timeControl: headers["TimeControl"] || "unknown",
  };
  
  console.log(`✅ מחזיר מידע מלא:`, JSON.stringify(result, null, 2));
  return result;
};


export const pollTournamentResults = async () => {
  try {
    console.log("🔄 Starting tournament results polling cycle");

    const activeTournaments = await TournamentModel.find({ status: "active" });
    console.log(`📊 Found ${activeTournaments.length} active tournaments to check`);

    for (const tournament of activeTournaments) {
      console.log(`🔍 Checking tournament: ${tournament._id} (${tournament.tournamentName})`);

      // בודקים את ה-stage של הטורניר
const stage = tournament.currentStage;

// בדיקה מפורשת אם הטורניר עדיין לא התחיל (אין לו bracket)
if (tournament.bracket.length === 0) {
  // הטורניר עוד לא התחיל - נדלג עליו בשקט, בלי להציג אזהרה
  continue;
} 
// בדיקה אם ה-stage לא תקין (אחרי שהטורניר כבר התחיל)
else if (stage < 0 || stage >= tournament.bracket.length) {
  // במקרה זה, זו באמת שגיאה - נציג אזהרה
  console.warn(`⚠️ Invalid currentStage (${stage}) in tournament ${tournament._id}`);
  continue;
}

// אם הגענו לכאן, ה-stage תקין והטורניר התחיל כבר
const currentBracket = tournament.bracket[stage];
if (!currentBracket || !currentBracket.matches?.length) {
  console.log(`ℹ️ No matches in current bracket for tournament ${tournament._id}`);
  continue;
}

      let allMatchesComplete = true;

      for (let matchIndex = 0; matchIndex < currentBracket.matches.length; matchIndex++) {
        const match = currentBracket.matches[matchIndex];

        const gameId = match.lichessUrl.split('/').pop()?.split('?')[0];
        if (!gameId) {
          console.warn(`⚠️ Invalid Lichess URL: ${match.lichessUrl}`);
          allMatchesComplete = false;
          continue;
        }

        // אם המשחק כבר סומן כגמור, נדלג עליו
        if (match.result === "finished" && match.winner !== undefined) {
          console.log(`✅ Match already finished: ${gameId}, winner: ${match.winner || 'Draw'}`);
          continue;
        }

        console.log(`🔄 Fetching game status for: ${gameId}`);

        try {
          const response = await fetchWithRetry(
            `https://lichess.org/game/export/${gameId}`,
            {
              headers: {
                Accept: "application/x-chess-pgn"
              },
              timeout: 3500
            },
            3
          );

          // בדיקה חשובה: אם התשובה אינה תקינה (404 וכו'), נדלג על המשחק הזה ונסמן שלא כל המשחקים הסתיימו
          if (!response.ok) {
            console.error(`❌ Failed to fetch PGN for game ${gameId}: ${response.status}`);
            console.log(`⚠️ Game ${gameId} returned ${response.status} - this usually means the game hasn't started yet or the ID is invalid`);
            allMatchesComplete = false;
            continue; // חשוב! דילוג על שאר הלוגיקה עבור משחק זה
          }

          const pgn = await response.text();
          console.log(`📊 Received PGN for game ${gameId}, length: ${pgn.length} characters`);
          
          // מיצוי התוצאה מה-PGN
          const resultMatch = pgn.match(/\[Result "(.*?)"\]/);
          const result = resultMatch?.[1] ?? null;

          console.log(`📋 Found result for game ${gameId}: "${result}"`);

          // תיקון חשוב: בליצ'ס, הסימן "*" מציין משחק בתהליך, לא תיקו!
          if (!result || result === "*") {
            console.log(`⏳ Game ${gameId} still in progress (result: ${result})`);
            allMatchesComplete = false;
            continue; // דלג אם המשחק עדיין בתהליך
          }

          // קביעת המנצח לפי צבע - רק עבור משחקים שהסתיימו באמת
          const winner = 
            result === "1-0" ? "white" :
            result === "0-1" ? "black" :
            result === "1/2-1/2" ? null :
            null;

          // קביעת ה-ID של המנצח (player1/player2)
          let winnerId: string | null = null;
          if (winner === "white") winnerId = match.player1;
          else if (winner === "black") winnerId = match.player2;
          // אם התוצאה היא תיקו או לא ברורה, נשאיר winnerId כ-null

          console.log(`🔄 About to update game ${gameId} with: result=${result}, winner=${winner}, winnerId=${winnerId ?? "Draw"}`);

          // עדכון התוצאה במסד הנתונים
          const updateResult = await TournamentModel.updateOne(
            {
              _id: tournament._id,
              [`bracket.${stage}.matches.${matchIndex}.lichessUrl`]: { $regex: gameId }
            },
            {
              $set: {
                [`bracket.${stage}.matches.${matchIndex}.result`]: "finished",
                [`bracket.${stage}.matches.${matchIndex}.winner`]: winnerId
              }
            }
          );

          console.log(`📝 Updated DB for game ${gameId}, modifiedCount=${updateResult.modifiedCount}`);

          // הוספת השחקן המנצח לרשימת המתקדמים (רק אם יש מנצח)
          if (winnerId && !tournament.advancingPlayers.includes(winnerId)) {
            await TournamentModel.updateOne(
              { _id: tournament._id },
              { $addToSet: { advancingPlayers: winnerId } }
            );
            console.log(`🏁 ${winnerId} added to advancing players`);
          }

        } catch (err) {
          console.error(`❌ Error checking game ${gameId}:`, err);
          allMatchesComplete = false; // חשוב! סימון שלא כל המשחקים הסתיימו במקרה של שגיאה
        }
      }

      // בדיקה אם כל המשחקים הסתיימו ויש צורך לקדם את הטורניר
      if (allMatchesComplete) {
        const advancing = tournament.advancingPlayers;
        console.log(`✅ All matches complete for tournament ${tournament._id}`);
        console.log(`👥 Advancing players: ${JSON.stringify(advancing)}`);

        // אם יש רק שחקן אחד מתקדם, זהו המנצח בטורניר
        if (advancing.length === 1) {
          const winner = advancing[0];
          console.log(`🏆 Tournament winner determined: ${winner}`);

          // עדכון הטורניר כמסתיים עם המנצח
          await TournamentModel.updateOne(
            { _id: tournament._id },
            {
              $set: {
                winner,
                status: "completed"
              }
            }
          );

          // חלוקת הפרס למנצח
          if (tournament.tournamentPrize > 0) {
            const winnerUser = await userModel.findOne({ lichessId: winner });
            if (winnerUser) {
              winnerUser.balance = (winnerUser.balance ?? 0) + tournament.tournamentPrize;
              await winnerUser.save();
              console.log(`💰 Prize awarded to ${winner}: ${tournament.tournamentPrize}`);
            } else {
              console.warn(`⚠️ Winner ${winner} not found in database, prize not awarded`);
            }
          }

        } else if (advancing.length > 1) {
          // אם יש יותר משחקן אחד, נקדם לסיבוב הבא
          console.log(`🧬 Advancing to next round with ${advancing.length} players`);
          await advanceTournamentRound((tournament._id as mongoose.Types.ObjectId).toString());

        } else {
          // מקרה שבו אין שחקנים מתקדמים
          console.warn(`⚠️ No advancing players yet for tournament ${tournament._id}. Skipping completion.`);
        }
      } else {
        console.log(`⏳ Some matches still pending in tournament ${tournament._id}. Waiting for next cycle.`);
      }
    }

    console.log("✅ Tournament polling cycle completed");
  } catch (err) {
    console.error("❌ Error in pollTournamentResults:", err);
  }
};



export const updateMatchResultByLichessUrlFromPolling = async (
  tournamentId: string,
  lichessUrl: string,
  winner: "white" | "black" | undefined,
  status: string
) => {
  try {
    console.log(`🔄 Updating match result for tournament ${tournamentId}, game ${lichessUrl}`);
    
    // Extract game ID from URL
    const gameId = lichessUrl.split('/').pop()?.split('?')[0];
    if (!gameId) {
      console.error(`❌ Invalid game URL format: ${lichessUrl}`);
      return;
    }
    
    // Find tournament directly using findOne to avoid type casting issues
    const tournament = await TournamentModel.findOne({ _id: tournamentId });
    if (!tournament) {
      console.error(`❌ Tournament not found: ${tournamentId}`);
      return;
    }
    
    // Find the matching bracket and match
    let matchFound = false;
    let bracketIndex = -1;
    let matchIndex = -1;
    
    for (let i = 0; i < tournament.bracket.length; i++) {
      const bracket = tournament.bracket[i];
      for (let j = 0; j < bracket.matches.length; j++) {
        const match = bracket.matches[j];
        const currentGameId = match.lichessUrl.split('/').pop()?.split('?')[0];
        
        if (currentGameId === gameId) {
          bracketIndex = i;
          matchIndex = j;
          matchFound = true;
          break;
        }
      }
      if (matchFound) break;
    }
    
    if (!matchFound) {
      console.error(`❌ Match not found for game ${gameId} in tournament ${tournamentId}`);
      return;
    }
    
    const match = tournament.bracket[bracketIndex].matches[matchIndex];
    
    // Determine winner
    let winnerId = null;
    if (winner === "white") {
      winnerId = match.player1;
    } else if (winner === "black") {
      winnerId = match.player2;
    }
    
    console.log(`🏆 Winner determined: ${winner} → ${winnerId}`);
    
    // Update the match directly
    const updateResult = await TournamentModel.updateOne(
      { _id: tournamentId },
      { 
        $set: { 
          [`bracket.${bracketIndex}.matches.${matchIndex}.result`]: status,
          [`bracket.${bracketIndex}.matches.${matchIndex}.winner`]: winnerId
        }
      }
    );
    
    console.log(`📝 Match update result: modified=${updateResult.modifiedCount}`);
    
    // If winner exists and is not already in advancing players, add them
    if (winnerId && !tournament.advancingPlayers.includes(winnerId)) {
      await TournamentModel.updateOne(
        { _id: tournamentId },
        { $addToSet: { advancingPlayers: winnerId } }
      );
      
      console.log(`🏁 Added ${winnerId} to advancing players`);
      
      // Check if we should advance to next round
      await advanceTournamentRound(tournamentId);
    }
    
    console.log(`✅ Successfully updated match result for game ${gameId}`);
  } catch (error) {
    console.error(`❌ Error updating match result:`, error);
  }
};



export default {
  detectCheating,
  analyzeSingleGame,
  analyzePlayerStyle,
  loginWithLichess,
  lichessCallback,
  autoMatchWithAI,
  joinLobby,
  createTournament,
  getTournamentById,
  startTournament,
  getGameResult,
  updateMatchResultByLichessUrl,
};