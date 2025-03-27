import axios from 'axios';
import { Request, Response } from 'express';
import userModel from '../models/user_model';
import jwt, { SignOptions } from 'jsonwebtoken';
import crypto from 'crypto';
import dotenv from 'dotenv';

// הרחבת session כדי לאפשר אחסון של codeVerifier
declare module 'express-session' {
  interface SessionData {
    codeVerifier?: string;
  }
}

dotenv.config();

const LICHESS_AUTHORIZE_URL = "https://lichess.org/oauth";
const LICHESS_TOKEN_URL = "https://lichess.org/api/token";
const LICHESS_ACCOUNT_URL = "https://lichess.org/api/account";

const clientId = process.env.LICHESS_CLIENT_ID!;
const redirectUri = process.env.LICHESS_REDIRECT_URI!;
const tokenSecret = process.env.TOKEN_SECRET!;
const tokenExpire = process.env.TOKEN_EXPIRE ?? '3d';

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

  const authUrl = `${LICHESS_AUTHORIZE_URL}?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}&scope=preference:read&code_challenge=${codeChallenge}&code_challenge_method=S256`;

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
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: codeVerifier,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const accessToken = tokenRes.data.access_token;

    const userInfoRes = await axios.get<LichessUser>(LICHESS_ACCOUNT_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const lichessUser = userInfoRes.data;
    const lichessId = lichessUser.id;

    let user = await userModel.findOne({ lichessId });
    if (!user) {
      user = await userModel.create({ lichessId });
    }

    const token = jwt.sign(
      { _id: user._id },
      tokenSecret,
      { expiresIn: parseDuration(tokenExpire) } as SignOptions
    );

    res.json({
      message: 'Login successful',
      accessToken: token,
      userId: user._id,
      lichessId: user.lichessId
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lichess login failed" });
  }
};

export default {
  loginWithLichess,
  lichessCallback
};
