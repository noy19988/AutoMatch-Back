"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getGameResult = void 0;
const axios_1 = __importDefault(require("axios"));
const user_model_1 = __importDefault(require("../models/user_model"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const crypto_1 = __importDefault(require("crypto"));
const dotenv_1 = __importDefault(require("dotenv"));
const GeminiApi_1 = require("../api/GeminiApi");
const tournament_model_1 = __importDefault(require("../models/tournament_model"));
const tournament_logic_1 = require("./tournament_logic"); // 💡 חשוב לייבא נכון
dotenv_1.default.config();
const frontendUrl = process.env.BASE_URL;
const LICHESS_AUTHORIZE_URL = "https://lichess.org/oauth";
const LICHESS_TOKEN_URL = "https://lichess.org/api/token";
const LICHESS_ACCOUNT_URL = "https://lichess.org/api/account";
const clientId = process.env.LICHESS_CLIENT_ID;
const redirectUri = process.env.LICHESS_REDIRECT_URI;
const tokenSecret = process.env.TOKEN_SECRET;
const tokenExpire = process.env.TOKEN_EXPIRE ?? "3d";
// פונקציה לפירוק משך זמן כמו "3d" לשניות
const parseDuration = (duration) => {
    const units = {
        s: 1,
        m: 60,
        h: 3600,
        d: 86400,
    };
    const match = duration.match(/^(\d+)([smhd])$/);
    if (!match)
        throw new Error("Invalid duration format");
    return parseInt(match[1]) * units[match[2]];
};
// פונקציות PKCE
function generateCodeVerifier() {
    return crypto_1.default.randomBytes(32).toString("base64url");
}
function generateCodeChallenge(verifier) {
    return crypto_1.default.createHash("sha256").update(verifier).digest("base64url");
}
// יצירת URL להפניית המשתמש להתחברות דרך Lichess
const loginWithLichess = (req, res) => {
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
async function fetchWithRetry(url, options, retries = 3) {
    let lastError;
    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            console.log(`🔄 Fetch attempt ${attempt + 1}/${retries} to ${url}`);
            // נסה לבצע את הבקשה
            const fetchResult = await fetch(url, options);
            return fetchResult;
        }
        catch (error) {
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
const lichessCallback = async (req, res) => {
    console.log("✅ Lichess callback reached");
    console.log("Request query:", req.query);
    console.log("Session ID:", req.sessionID);
    console.log("Session contents:", req.session);
    const code = req.query.code;
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
        const tokenRes = await fetchWithRetry(LICHESS_TOKEN_URL, {
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
        }, 3 // מספר ניסיונות חוזרים
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
        const tokenData = await tokenRes.json();
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
            const lichessUser = await userInfoRes.json();
            const lichessId = lichessUser.id;
            console.log(`✅ Fetched user info: ${lichessId}`);
            // מציאת המשתמש במסד הנתונים או יצירת אחד חדש
            let user = await user_model_1.default.findOne({ lichessId });
            if (!user) {
                console.log(`🆕 Creating new user with lichessId: ${lichessId}`);
                user = await user_model_1.default.create({
                    lichessId,
                    lichessAccessToken: accessToken,
                });
            }
            else {
                console.log(`✏️ Updating existing user: ${lichessId}`);
                user.lichessAccessToken = accessToken;
                await user.save();
            }
            // יצירת טוקן JWT
            const token = jsonwebtoken_1.default.sign({ _id: user._id }, tokenSecret, {
                expiresIn: parseDuration(tokenExpire),
            });
            console.log(`✅ Successfully processed login for user: ${lichessId}`);
            console.log(`🔄 Redirecting to: ${frontendUrl}/login?token=${token}&userId=${user._id}&lichessId=${user.lichessId}`);
            res.redirect(`${frontendUrl}/login?token=${token}&userId=${user._id}&lichessId=${user.lichessId}`);
            return;
        }
        catch (userError) {
            console.error("❌ Error during user info fetch:", userError);
            res.status(500).json({
                error: "Failed to fetch user info from Lichess",
                details: userError instanceof Error ? userError.message : "Unknown error"
            });
            return;
        }
    }
    catch (err) {
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
const autoMatchWithAI = async (req, res) => {
    try {
        const users = await user_model_1.default.find({ lichessId: { $exists: true } });
        const enrichedUsers = await Promise.all(users.map(async (user) => {
            try {
                const res = await axios_1.default.get(`https://lichess.org/api/user/${user.lichessId}`);
                const data = res.data;
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
            }
            catch (err) {
                console.warn("`⚠️ Failed to fetch data for ${user.lichessId}`", err);
                return null;
            }
        }));
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
        const aiResponse = await (0, GeminiApi_1.askGeminiRaw)(prompt);
        const cleaned = cleanJsonFromAI(aiResponse);
        let parsed;
        try {
            parsed = JSON.parse(cleaned);
        }
        catch (parseErr) {
            console.error("❌ Failed to parse Gemini response:", parseErr);
            console.error("📦 Raw response from AI:", aiResponse);
            res.status(500).json({ error: "Invalid AI response format." });
        }
        if (parsed.player1 && parsed.player2) {
            res.status(200).json({
                message: "AI Match found",
                match: parsed,
            });
        }
        else {
            res.status(404).json({ message: "AI could not find a match." });
        }
    }
    catch (err) {
        console.error("AI AutoMatch Error", err);
        res.status(500).send("Server error");
    }
};
function cleanJsonFromAI(raw) {
    return (raw || "").replace(/json/g, "").replace(/ /g, "").trim();
}
const createTournament = async (req, res) => {
    const { createdBy, playerIds, maxPlayers, tournamentName } = req.body;
    console.log("🎯 Received tournament body:", req.body);
    // Ensure the tournament name is provided
    if (!tournamentName ||
        !createdBy ||
        !Array.isArray(playerIds) ||
        playerIds.length < 1) {
        return res.status(400).json({
            error: "Tournament name, at least one player, and creator are required.",
        });
    }
    try {
        const creator = await user_model_1.default.findById(createdBy);
        if (!creator || !creator.lichessAccessToken) {
            return res
                .status(403)
                .json({ error: "Tournament creator not authorized with Lichess." });
        }
        // Check if a completed tournament exists with the same parameters
        const existingTournament = await tournament_model_1.default.findOne({
            createdBy,
            maxPlayers,
            status: "completed", // Only check for completed tournaments
        });
        if (existingTournament) {
            console.log("✅ Found a completed tournament. It can be replaced.");
            // Optionally delete the completed tournament
            await tournament_model_1.default.deleteOne({ _id: existingTournament._id });
            console.log("🧹 Deleted the completed tournament:", existingTournament);
        }
        const tournament = await tournament_model_1.default.create({
            tournamentName,
            createdBy,
            playerIds,
            rated: true,
            maxPlayers: parseInt(maxPlayers, 10),
            bracket: [], // במקום rounds
            currentStage: 0, // התחלה מ-Round 1
            advancingPlayers: [],
            winner: null,
            status: "active",
        });
        res.status(201).json({
            message: "Tournament created",
            tournament,
            lobbyUrl: `${frontendUrl}/lobby/${tournament._id}`,
        });
    }
    catch (error) {
        console.error("❌ Error creating tournament:", error);
        res.status(500).json({ error: "Internal server error." });
    }
};
const joinLobby = async (req, res) => {
    const { username } = req.body;
    const { id } = req.params;
    if (!username)
        return res.status(400).json({ error: "Missing username" });
    try {
        const tournament = await tournament_model_1.default.findById(id);
        if (!tournament)
            return res.status(404).json({ error: "Tournament not found" });
        if (!tournament.playerIds.includes(username)) {
            tournament.playerIds.push(username);
            await tournament.save();
        }
        res.json({ message: "Joined", tournament });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
};
const getTournamentById = async (req, res) => {
    try {
        const tournament = await tournament_model_1.default.findById(req.params.id);
        if (!tournament) {
            return res.status(404).json({ error: "Tournament not found" });
        }
        res.json(tournament);
    }
    catch (err) {
        console.error("❌ Failed to get tournament:", err);
        res.status(500).json({ error: "Server error" });
    }
};
// פונקציה זו בודקת אם הטוקן תקף
async function validateLichessToken(token) {
    try {
        const response = await fetch(LICHESS_ACCOUNT_URL, {
            headers: {
                Authorization: `Bearer ${token}`
            },
        });
        return response.ok;
    }
    catch (error) {
        console.error("❌ Token validation failed:", error);
        return false;
    }
}
// תקן את השגיאות של טיפוס בפונקציית startTournament
const startTournament = async (req, res) => {
    try {
        const { id } = req.params;
        console.log(`🔄 התחלת טורניר ${id}`);
        const tournament = await tournament_model_1.default.findById(id);
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
        const creator = await user_model_1.default.findById(tournament.createdBy);
        if (!creator || !creator.lichessAccessToken) {
            return res.status(403).json({ error: "Creator not authorized with Lichess" });
        }
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
        for (let i = 0; i < shuffled.length; i += 2) {
            const p1Id = shuffled[i];
            const p2Id = shuffled[i + 1];
            try {
                // במקום לחפש משתמש, ננסה ליצור משחק פתוח ישירות
                const challengeRes = await axios_1.default.post("https://lichess.org/api/challenge/open", {
                    rated: tournament.rated,
                    clock: { limit: 300, increment: 0 },
                    variant: "standard",
                }, {
                    headers: {
                        Authorization: `Bearer ${creator.lichessAccessToken}`,
                        Accept: "application/json",
                    },
                    timeout: 10000
                });
                // עדכון ממשק LichessChallengeResponse קודם לכן
                // טיפול בטוח ב-ID של המשחק
                // השתמש ב-type assertion כדי לעקוף את בדיקת הטיפוס
                const responseData = challengeRes.data;
                const gameId = responseData.id || responseData.challenge?.id;
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
                // המתן מעט בין בקשות כדי להימנע מ-rate limiting
                await new Promise(resolve => setTimeout(resolve, 1500));
            }
            catch (err) {
                console.error(`❌ Error creating match for ${p1Id} vs ${p2Id}:`, err);
                // יצירת רשומת משחק עם סימון שגיאה
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
        const updatedTournament = await tournament_model_1.default.findByIdAndUpdate(tournament._id, {
            $set: {
                bracket: [
                    {
                        name: "Round 1",
                        matches,
                        startTime: new Date(),
                    },
                ],
                currentStage: 0,
                advancingPlayers: byePlayer ? [byePlayer] : [],
            },
        }, { new: true });
        return res.status(200).json({
            message: "Tournament started successfully",
            matches,
            byePlayer,
            tournament: updatedTournament,
        });
    }
    catch (err) {
        console.error("❌ Error starting tournament:", err);
        return res.status(500).json({
            error: "Internal server error",
            details: err instanceof Error ? err.message : "Unknown error",
        });
    }
};
const updateMatchResultByLichessUrl = async (req, res) => {
    try {
        console.log("🔍 Request received to update match:", req.body);
        const { lichessUrl, winner, status } = req.body;
        if (!lichessUrl) {
            console.log("❌ Missing lichessUrl in request body");
            return res.status(400).json({ error: "Missing lichessUrl" });
        }
        // הפקת ה-gameId מה-URL
        const gameId = lichessUrl.split('/').pop()?.split('?')[0];
        if (!gameId) {
            return res.status(400).json({ error: "Invalid lichessUrl format" });
        }
        // חיפוש הטורניר לפי URL מלא או לפי ID המשחק
        const tournament = await tournament_model_1.default.findOne({
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
        let winningPlayerId = null;
        // עדכון התוצאה במשחק המתאים
        for (let bracketIndex = 0; bracketIndex < tournament.bracket.length; bracketIndex++) {
            const bracket = tournament.bracket[bracketIndex];
            for (let matchIndex = 0; matchIndex < bracket.matches.length; matchIndex++) {
                const match = bracket.matches[matchIndex];
                // בדיקה אם המשחק מתאים לפי URL מלא או gameId
                const currentGameId = match.lichessUrl.split('/').pop()?.split('?')[0];
                if (match.lichessUrl === lichessUrl || currentGameId === gameId) {
                    console.log(`✅ Found matching game in bracket ${bracketIndex}, match ${matchIndex}`);
                    // קביעת המנצח
                    if (winner === "white") {
                        winningPlayerId = match.player1;
                    }
                    else if (winner === "black") {
                        winningPlayerId = match.player2;
                    }
                    else {
                        winningPlayerId = "draw";
                    }
                    // עדכון המשחק
                    const updatePath = `bracket.${bracketIndex}.matches.${matchIndex}`;
                    const updateObj = {};
                    updateObj[`${updatePath}.result`] = status || "completed";
                    updateObj[`${updatePath}.winner`] = winningPlayerId;
                    await tournament_model_1.default.updateOne({ _id: tournament._id }, { $set: updateObj });
                    console.log(`✅ Updated match result to status: ${status}, winner: ${winningPlayerId}`);
                    updated = true;
                    // אם המשחק בסיבוב הנוכחי, הוספת המנצח לרשימת המתקדמים
                    if (bracketIndex === tournament.currentStage &&
                        winningPlayerId !== "draw" &&
                        winningPlayerId !== null &&
                        !tournament.advancingPlayers.includes(winningPlayerId)) {
                        tournament.advancingPlayers.push(winningPlayerId);
                        await tournament.save();
                        console.log(`🏁 ${winningPlayerId} advanced to next round`);
                        // ניסיון לקדם את הטורניר באופן אוטומטי
                        try {
                            await (0, tournament_logic_1.advanceTournamentRound)(tournament._id.toString());
                        }
                        catch (advanceError) {
                            console.error("❌ Error advancing tournament:", advanceError);
                            // איננו מחזירים שגיאה למשתמש כי עדכון המשחק הצליח
                        }
                    }
                    break;
                }
            }
            if (updated)
                break;
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
    }
    catch (err) {
        console.error("❌ Error updating match result:", err);
        return res.status(500).json({
            error: "Internal server error",
            details: err instanceof Error ? err.message : "Unknown error",
        });
    }
};
const getGameResult = async (req, res) => {
    const { gameId } = req.params;
    try {
        // Fetch game result from Lichess
        const response = await axios_1.default.get(`https://lichess.org/api/games/export/${gameId}`, {
            headers: { Accept: "application/json" },
            params: { moves: false, clocks: false, evals: false },
        });
        const data = response.data;
        const winnerColor = data.winner; // "white" or "black"
        const whitePlayer = data.players.white?.user;
        const blackPlayer = data.players.black?.user;
        let winnerName = "Draw"; // Default to "Draw" if no winner is found
        if (winnerColor === "white" && whitePlayer) {
            winnerName = whitePlayer.username || "Unknown Player";
        }
        else if (winnerColor === "black" && blackPlayer) {
            winnerName = blackPlayer.username || "Unknown Player";
        }
        const status = data.status === "resign" ? "One player resigned" : data.status;
        console.log("winner: ", winnerName);
        // Send the result with the winner and status
        return res.json({
            winner: winnerName,
            status: status,
            whitePlayer: whitePlayer?.username,
            blackPlayer: blackPlayer?.username,
        });
    }
    catch (error) {
        console.error("Failed to fetch game result:", error);
        return res.status(500).json({ error: "Failed to fetch game result" });
    }
};
exports.getGameResult = getGameResult;
exports.default = {
    loginWithLichess,
    lichessCallback,
    autoMatchWithAI,
    joinLobby,
    createTournament,
    getTournamentById,
    startTournament,
    getGameResult: exports.getGameResult,
    updateMatchResultByLichessUrl,
};
