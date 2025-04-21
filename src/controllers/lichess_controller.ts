import axios from "axios";
import { Request, Response } from "express";
import userModel from "../models/user_model";
import jwt, { SignOptions } from "jsonwebtoken";
import crypto from "crypto";
import dotenv from "dotenv";
import { askGeminiRaw } from "../api/GeminiApi";
import TournamentModel from "../models/tournament_model";

// הרחבת session כדי לאפשר אחסון של codeVerifier
declare module "express-session" {
  interface SessionData {
    codeVerifier?: string;
  }
}

interface LichessChallengeResponse {
  id: string;
  whiteUrl: string;
  blackUrl: string;
  // add more fields if needed
}

interface LichessGameExport {
  winner?: "white" | "black";
  status?: string;
  players: {
    white?: { user?: { id: string } };
    black?: { user?: { id: string } };
  };
}

dotenv.config();

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
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  req.session.codeVerifier = codeVerifier;

  const authUrl = `${LICHESS_AUTHORIZE_URL}?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}&scope=challenge:write%20board:play%20bot:play&code_challenge=${codeChallenge}&code_challenge_method=S256`;
  res.redirect(authUrl);
};

// callback מה-lichess
const lichessCallback = async (req: Request, res: Response): Promise<void> => {
  const code = req.query.code as string;
  const codeVerifier = req.session.codeVerifier;

  if (!codeVerifier) {
    res.status(400).json({ error: "Missing code_verifier from session" });
    return;
  }

  try {
    const tokenRes = await axios.post<LichessTokenResponse>(
      LICHESS_TOKEN_URL,
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: codeVerifier,
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const accessToken = tokenRes.data.access_token;

    const userInfoRes = await axios.get<LichessUser>(LICHESS_ACCOUNT_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const lichessUser = userInfoRes.data;
    const lichessId = lichessUser.id;

    let user = await userModel.findOne({ lichessId });
    if (!user) {
      user = await userModel.create({
        lichessId,
        lichessAccessToken: accessToken,
      });
    } else {
      user.lichessAccessToken = accessToken;
      await user.save(); // <-- This saves the token
    }

    const token = jwt.sign({ _id: user._id }, tokenSecret, {
      expiresIn: parseDuration(tokenExpire),
    } as SignOptions);

    res.redirect(
      `http://localhost:5173/login?token=${token}&userId=${user._id}&lichessId=${user.lichessId}`
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lichess login failed" });
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

const createTournament = async (req: Request, res: Response) => {
  const { createdBy, playerIds, maxPlayers } = req.body;
  console.log("🎯 Received tournament body:", req.body);

  if (!createdBy || !Array.isArray(playerIds) || playerIds.length < 1) {
    return res.status(400).json({ error: "At least one player required." });
  }

  try {
    const creator = await userModel.findById(createdBy);
    if (!creator || !creator.lichessAccessToken) {
      return res
        .status(403)
        .json({ error: "Tournament creator not authorized with Lichess." });
    }

    // Check if a completed tournament exists with the same parameters
    const existingTournament = await TournamentModel.findOne({
      createdBy,
      maxPlayers,
      status: "completed", // Only check for completed tournaments
    });

    if (existingTournament) {
      console.log("✅ Found a completed tournament. It can be replaced.");
      // Optionally delete the completed tournament
      await TournamentModel.deleteOne({ _id: existingTournament._id });
      console.log("🧹 Deleted the completed tournament:", existingTournament);
    }

    // Proceed with tournament creation
    const tournament = await TournamentModel.create({
      createdBy,
      playerIds,
      maxPlayers: parseInt(maxPlayers, 10),
      rounds: [],
      winner: null,
      status: "active", // Mark the new tournament as active
    });

    res.status(201).json({
      message: "Tournament created",
      tournament,
      lobbyUrl: `http://localhost:5173/lobby/${tournament._id}`,
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
    if (!tournament)
      return res.status(404).json({ error: "Tournament not found" });

    if (!tournament.playerIds.includes(username)) {
      tournament.playerIds.push(username);
      await tournament.save();
    }

    res.json({ message: "Joined", tournament });
  } catch (err) {
    console.error(err);
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
const startTournament = async (req: Request, res: Response) => {
  const { id } = req.params;
  const tournament = await TournamentModel.findById(id);
  if (!tournament) return res.status(404).json({ error: "Not found" });

  // ✅ Prevent duplicate starts
  if (tournament.rounds.length > 0) {
    return res.status(400).json({ error: "Tournament already started." });
  }

  // ✅ Prevent starting unless lobby is full
  if (tournament.playerIds.length !== tournament.maxPlayers) {
    return res.status(400).json({ error: "Lobby not full" });
  }

  // ✅ Validate creator
  const creator = await userModel.findById(tournament.createdBy);
  if (!creator || !creator.lichessAccessToken) {
    return res
      .status(403)
      .json({ error: "Creator not authorized with Lichess" });
  }

  const validPlayers = tournament.playerIds.filter(Boolean);

  // 🔀 Shuffle players
  const shuffled = validPlayers.sort(() => 0.5 - Math.random());
  const matches = [];

  // 🧠 If odd number, remove 1 player and log (optional)
  if (shuffled.length % 2 !== 0) {
    const byePlayer = shuffled.pop();
    console.log(`🚨 Player ${byePlayer} gets a bye this round`);
    // You can store byePlayer somewhere if needed
  }

  // ♟️ Pair players and create matches
  for (let i = 0; i < shuffled.length; i += 2) {
    const p1 = shuffled[i];
    const p2 = shuffled[i + 1];

    try {
      const response = await axios.post<LichessChallengeResponse>(
        "https://lichess.org/api/challenge/open",
        {
          rated: false,
          clock: { limit: 300, increment: 0 },
          variant: "standard",
        },
        {
          headers: {
            Authorization: `Bearer ${creator.lichessAccessToken}`,
          },
        }
      );

      const challenge = response.data;

      matches.push({
        player1: p1,
        player2: p2,
        lichessUrl: `https://lichess.org/${challenge.id}`,
        whiteUrl: challenge.whiteUrl,
        blackUrl: challenge.blackUrl,
        result: "pending",
      });
    } catch (err) {
      console.error(`❌ Failed to create game for ${p1} vs ${p2}:`, err);
    }
  }

  const gameUrls = matches.map((m) => m.lichessUrl);
  console.log("🎯 Chess games created:", gameUrls);

  // ✅ Save all matches in round 1
  await TournamentModel.findByIdAndUpdate(tournament._id, {
    $push: { rounds: { matches } },
  });

  res.json({ message: "Tournament started", matches });
};

// /controllers/lichess_controller.ts

const updateMatchResult = async (req: Request, res: Response) => {
  const { tournamentId, roundIndex, matchIndex } = req.params;

  try {
    const tournament = await TournamentModel.findById(tournamentId);
    if (!tournament)
      return res.status(404).json({ error: "Tournament not found" });

    const round = tournament.rounds[+roundIndex];
    if (!round) return res.status(404).json({ error: "Round not found" });

    const match = round.matches[+matchIndex];
    if (!match) return res.status(404).json({ error: "Match not found" });

    const gameId = match.lichessUrl.split("/").pop(); // Extract game ID
    const creator = await userModel.findById(tournament.createdBy);
    if (!creator?.lichessAccessToken) {
      return res
        .status(403)
        .json({ error: "Creator is not authorized with Lichess" });
    }

    // 🔍 Fetch game result from Lichess
    const response = await axios.get<LichessGameExport>(
      `https://lichess.org/game/export/${gameId}`,
      {
        headers: {
          Authorization: `Bearer ${creator.lichessAccessToken}`,
        },
      }
    );

    const data = response.data;

    const winnerColor = data.winner; // "white" or "black"
    const whiteId = data.players.white?.user?.id?.toLowerCase();
    const blackId = data.players.black?.user?.id?.toLowerCase();

    const p1 = match.player1.toLowerCase();
    const p2 = match.player2.toLowerCase();

    let winner: "player1" | "player2" | "draw" | null = null;

    if (winnerColor === "white" && whiteId === p1) winner = "player1";
    else if (winnerColor === "white" && whiteId === p2) winner = "player2";
    else if (winnerColor === "black" && blackId === p1) winner = "player1";
    else if (winnerColor === "black" && blackId === p2) winner = "player2";
    else if (!winnerColor && data.status === "draw") winner = "draw";

    if (!winner) {
      return res.status(400).json({
        error: "Could not determine winner",
        info: { whiteId, blackId, winnerColor, p1, p2 },
      });
    }

    match.result = winner;
    await tournament.save();

    res.json({
      message: "Match result updated",
      winner,
      matchIndex,
      white: whiteId,
      black: blackId,
    });
  } catch (err) {
    console.error("❌ Failed to update match result:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const getGameResult = async (req: Request, res: Response) => {
  const { gameId } = req.params;

  try {
    // First try to get the game status using the games API
    try {
      interface GameStatusResponse {
        status: string;
      }

      const statusResponse = await axios.get<GameStatusResponse>(
        `https://lichess.org/api/games/export/${gameId}`,
        {
          headers: {
            Accept: "application/json", // Request JSON format
          },
          params: {
            moves: false, // We don't need the moves
            clocks: false, // We don't need the clocks
            evals: false, // We don't need the evaluations
          },
        }
      );

      // If we get a valid JSON response, extract the status
      if (statusResponse.data) {
        const { status } = statusResponse.data;
        return res.json({ status });
      }
    } catch (exportError) {
      console.log("Failed with export API, trying status API:", exportError);
      // If the first method fails, continue to the next
    }

    // Alternative method: check if the game exists using status API
    try {
      const gameResponse = await axios.get(
        `https://lichess.org/api/game/export/${gameId}?literate=true`,
        {
          responseType: "text", // Accept any response type as text
        }
      );

      // If we get here, the game exists and we can extract status from response
      // This might be a PGN file or HTML, so we need to parse manually
      const responseText = gameResponse.data;

      // Try to extract status from the response
      let status = "unknown";

      // Check if this is a PGN file and extract the status from the headers
      if (
        typeof responseText === "string" &&
        responseText.includes("[Result ")
      ) {
        const resultMatch = responseText.match(/\[Result "(.*?)"\]/);
        if (resultMatch && resultMatch[1]) {
          const result = resultMatch[1];
          // Convert PGN result to status
          if (result === "1-0") status = "white wins";
          else if (result === "0-1") status = "black wins";
          else if (result === "1/2-1/2") status = "draw";
          else status = "ongoing";
        }
      }

      // Try to extract status from HTML (if that's what we got)
      if (
        typeof responseText === "string" &&
        responseText.includes("<title>")
      ) {
        if (
          responseText.includes("white won") ||
          responseText.includes("White won")
        ) {
          status = "white wins";
        } else if (
          responseText.includes("black won") ||
          responseText.includes("Black won")
        ) {
          status = "black wins";
        } else if (
          responseText.includes("draw") ||
          responseText.includes("Draw")
        ) {
          status = "draw";
        } else if (
          responseText.includes("ongoing") ||
          responseText.includes("Ongoing")
        ) {
          status = "ongoing";
        } else if (
          responseText.includes("aborted") ||
          responseText.includes("Aborted")
        ) {
          status = "aborted";
        }
      }

      return res.json({ status });
    } catch (err) {
      // If both methods fail, the game likely doesn't exist
      return res.status(404).json({ error: "Game not found" });
    }
  } catch (err) {
    console.error("Error fetching game result from Lichess:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
export default {
  loginWithLichess,
  lichessCallback,
  autoMatchWithAI,
  joinLobby,
  createTournament,
  getTournamentById,
  startTournament,
  updateMatchResult,
  getGameResult,
};
