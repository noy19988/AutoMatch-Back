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
  challenge: {
    id: string;
    // add more fields if needed
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

  const authUrl = `${LICHESS_AUTHORIZE_URL}?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}&scope=challenge:write board:play bot:play&code_challenge=${codeChallenge}&code_challenge_method=S256`;
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
          console.warn(`⚠️ Failed to fetch data for ${user.lichessId}`, err);
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
      Do NOT include any markdown formatting (like \`\`\` or \`\`\`json). Only return plain JSON.

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
  return (raw || "")
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();
}

const createTournament = async (req: Request, res: Response) => {
  const { createdBy, playerIds, maxPlayers } = req.body;
  console.log("🎯 Received tournament body:", req.body);

  if (!createdBy || !Array.isArray(playerIds) || playerIds.length < 1) {
    return res
      .status(400)
      .json({ error: "Missing or invalid tournament input." });
  }

  try {
    const creator = await userModel.findById(createdBy);
    if (!creator || !creator.lichessAccessToken) {
      return res
        .status(403)
        .json({ error: "Tournament creator not authorized with Lichess." });
    }

    const shuffled = playerIds.sort(() => 0.5 - Math.random());
    const pairs = [];
    for (let i = 0; i < shuffled.length - 1; i += 2) {
      pairs.push([shuffled[i], shuffled[i + 1]]);
    }

    const matches = await Promise.all(
      pairs.map(async ([p1, p2]) => {
        try {
          const response = await axios.post<LichessChallengeResponse>(
            `https://lichess.org/api/challenge/${p2}`,
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

          return {
            player1: p1,
            player2: p2,
            lichessUrl: `https://lichess.org/${response.data.challenge.id}`,
          };
        } catch (err) {
          console.error(`Failed to create game between ${p1} and ${p2}`, err);
          return null;
        }
      })
    );

    const validMatches = matches.filter(Boolean);

    const tournament = await TournamentModel.create({
      createdBy,
      playerIds,
      maxPlayers: parseInt(maxPlayers, 10),
      rounds: [{ matches: validMatches }],
      winner: null,
    });

    res.status(201).json({
      message: "Tournament created",
      tournament,
      lobbyUrl: `http://localhost:5173/lobby/${tournament._id}`,
    });
  } catch (error) {
    console.error("Error creating tournament:", error);
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

  if (tournament.playerIds.length !== tournament.maxPlayers) {
    return res.status(400).json({ error: "Lobby not full" });
  }

  const creator = await userModel.findById(tournament.createdBy);
  if (!creator) return res.status(403).json({ error: "Creator not found" });

  const shuffled = tournament.playerIds.sort(() => 0.5 - Math.random());
  const matches = [];

  for (let i = 0; i < shuffled.length - 1; i += 2) {
    const p1 = shuffled[i];
    const p2 = shuffled[i + 1];

    try {
      const response = await axios.post<LichessChallengeResponse>(
        `https://lichess.org/api/challenge/${p2}`,
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

      if (!response.data?.challenge?.id) {
        console.error(
          `❌ No challenge ID returned from Lichess for ${p2}`,
          response.data
        );
        continue;
      }

      matches.push({
        player1: p1,
        player2: p2,
        lichessUrl: `https://lichess.org/${response.data.challenge.id}`,
      });
    } catch (err) {
      console.error(`❌ Failed to challenge ${p2}`, err);
    }
  }

  const gameUrls = matches.map((m) => m.lichessUrl);
  console.log("🎯 Chess games created:", gameUrls);

  await TournamentModel.findByIdAndUpdate(tournament._id, {
    $push: { rounds: { matches } },
  });

  res.json({ message: "Tournament started", matches });
};
export default {
  loginWithLichess,
  lichessCallback,
  autoMatchWithAI,
  joinLobby,
  createTournament,
  getTournamentById,
  startTournament,
};
