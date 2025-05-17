"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectCheating = exports.analyzeSingleGame = exports.analyzePlayerStyle = exports.getGameResult = exports.createTournament = void 0;
const axios_1 = __importDefault(require("axios"));
const user_model_1 = __importDefault(require("../models/user_model"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const crypto_1 = __importDefault(require("crypto"));
const dotenv_1 = __importDefault(require("dotenv"));
const GeminiApi_1 = require("../api/GeminiApi");
const tournament_model_1 = __importDefault(require("../models/tournament_model"));
const tournament_logic_1 = require("./tournament_logic"); // 💡 חשוב לייבא נכון
const getBracketName = (playerCount) => {
    switch (playerCount) {
        case 2: return "Final";
        case 4: return "Semifinals";
        case 8: return "Quarterfinals";
        case 16: return "Round of 16";
        case 32: return "Round of 32";
        default: return `Round of ${playerCount}`;
    }
};
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
                    balance: 0,
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
    const { createdBy, playerIds, maxPlayers, tournamentName, visibility, entryFee, } = req.body;
    try {
        const creator = await user_model_1.default.findById(createdBy);
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
        const userRes = await fetch(`https://lichess.org/api/user/${creator.lichessId}`);
        if (!userRes.ok) {
            console.warn("⚠️ Failed to fetch user data from Lichess:", userRes.statusText);
        }
        const userData = await userRes.json();
        const blitzRating = userData?.perfs?.blitz?.rating ?? 1500;
        // קביעת טווח דירוג
        let rankRange = { label: "Beginner", min: 0, max: 1200 };
        if (blitzRating >= 1200 && blitzRating < 1400) {
            rankRange = { label: "Intermediate", min: 1200, max: 1400 };
        }
        else if (blitzRating >= 1400 && blitzRating < 1700) {
            rankRange = { label: "Pro", min: 1400, max: 1700 };
        }
        else if (blitzRating >= 1700) {
            rankRange = { label: "Elite", min: 1700, max: 2200 };
        }
        // חישוב סכום הפרס
        const tournamentPrize = entryFee * maxPlayers;
        // ✅ יצירת הטורניר
        const tournament = await tournament_model_1.default.create({
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
    }
    catch (error) {
        console.error("❌ Error creating tournament:", error);
        res.status(500).json({ error: "Internal server error." });
    }
};
exports.createTournament = createTournament;
const joinLobby = async (req, res) => {
    const { username } = req.body;
    const { id } = req.params;
    if (!username)
        return res.status(400).json({ error: "Missing username" });
    try {
        const tournament = await tournament_model_1.default.findById(id);
        if (!tournament) {
            return res.status(404).json({ error: "Tournament not found" });
        }
        const user = await user_model_1.default.findOne({ lichessId: username });
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }
        if ((user.balance ?? 0) < tournament.entryFee) {
            return res.status(403).json({ error: "Insufficient balance to join tournament" });
        }
        if (!tournament.playerIds.includes(username)) {
            tournament.playerIds.push(username);
            await tournament.save();
        }
        res.json({ message: "Joined", tournament });
    }
    catch (err) {
        console.error("❌ joinLobby error:", err);
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
        // ✅ בדיקה וחיוב של כל שחקן
        const entryFee = tournament.entryFee ?? 0;
        for (const lichessId of tournament.playerIds) {
            const user = await user_model_1.default.findOne({ lichessId });
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
            const user = await user_model_1.default.findOne({ lichessId });
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
                const challengeRes = await axios_1.default.post("https://lichess.org/api/challenge/open", {
                    rated: tournament.rated,
                    clock: { limit: 300, increment: 0 },
                    variant: "standard",
                }, {
                    headers: {
                        Authorization: `Bearer ${creator.lichessAccessToken}`,
                        Accept: "application/json",
                    },
                    timeout: 10000,
                });
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
                await new Promise((resolve) => setTimeout(resolve, 1500));
            }
            catch (err) {
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
        const updatedTournament = await tournament_model_1.default.findByIdAndUpdate(tournament._id, {
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
        const gameId = lichessUrl.split('/').pop()?.split('?')[0];
        if (!gameId) {
            return res.status(400).json({ error: "Invalid lichessUrl format" });
        }
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
        for (let bracketIndex = 0; bracketIndex < tournament.bracket.length; bracketIndex++) {
            const bracket = tournament.bracket[bracketIndex];
            for (let matchIndex = 0; matchIndex < bracket.matches.length; matchIndex++) {
                const match = bracket.matches[matchIndex];
                const currentGameId = match.lichessUrl.split('/').pop()?.split('?')[0];
                if (match.lichessUrl === lichessUrl || currentGameId === gameId) {
                    console.log(`✅ Found matching game in bracket ${bracketIndex}, match ${matchIndex}`);
                    if (winner === "white") {
                        winningPlayerId = match.player1;
                    }
                    else if (winner === "black") {
                        winningPlayerId = match.player2;
                    }
                    else {
                        winningPlayerId = "draw";
                    }
                    const updatePath = `bracket.${bracketIndex}.matches.${matchIndex}`;
                    const updateObj = {};
                    updateObj[`${updatePath}.result`] = status || "completed";
                    updateObj[`${updatePath}.winner`] = winningPlayerId;
                    await tournament_model_1.default.updateOne({ _id: tournament._id }, { $set: updateObj });
                    console.log(`✅ Updated match result to status: ${status}, winner: ${winningPlayerId}`);
                    updated = true;
                    // advancing
                    if (bracketIndex === tournament.currentStage &&
                        winningPlayerId !== "draw" &&
                        winningPlayerId !== null &&
                        !tournament.advancingPlayers.includes(winningPlayerId)) {
                        tournament.advancingPlayers.push(winningPlayerId);
                        await tournament.save();
                        console.log(`🏁 ${winningPlayerId} advanced to next round`);
                        if (tournament.status === "completed") {
                            console.log("🏁 Tournament is already completed. Skipping advancement.");
                        }
                        else {
                            try {
                                await (0, tournament_logic_1.advanceTournamentRound)(tournament._id.toString());
                            }
                            catch (advanceError) {
                                console.error("❌ Error advancing tournament:", advanceError);
                            }
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
const analyzePlayerStyle = async (req, res) => {
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
        const responseFromGemini = await (0, GeminiApi_1.askGeminiRaw)(prompt);
        if (!responseFromGemini) {
            return res.status(500).json({ error: "AI failed to generate analysis" });
        }
        return res.status(200).json({
            username,
            analysis: responseFromGemini.trim(),
        });
    }
    catch (err) {
        console.error("❌ Error in analyzePlayerStyle:", err);
        return res.status(500).json({ error: "Internal server error" });
    }
};
exports.analyzePlayerStyle = analyzePlayerStyle;
const analyzeSingleGame = async (req, res) => {
    const { gameId, username } = req.params;
    if (!gameId || !username) {
        return res.status(400).json({ error: "Missing gameId or username" });
    }
    try {
        // ניקוי מזהה המשחק
        const cleanGameId = gameId.split('/').pop()?.split('?')[0] || gameId;
        console.log(`🔍 Attempting to fetch game: ${cleanGameId}`);
        const lichessApiUrl = `https://lichess.org/api/game/${cleanGameId}`;
        console.log(`🌍 Fetching from: ${lichessApiUrl}`);
        // פונקציה לביצוע ניסיונות חוזרים
        const fetchWithRetry = async (url, options, retries = 3, timeout = 15000) => {
            let lastError;
            for (let attempt = 0; attempt < retries; attempt++) {
                try {
                    console.log(`🔄 Fetch attempt ${attempt + 1}/${retries}`);
                    // הוספת timeout ארוך יותר
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), timeout);
                    const fetchOptions = {
                        ...options,
                        signal: controller.signal
                    };
                    const response = await fetch(url, fetchOptions);
                    clearTimeout(timeoutId);
                    return response;
                }
                catch (error) {
                    console.log(`❌ Attempt ${attempt + 1} failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
                    lastError = error;
                    // המתנה לפני ניסיון נוסף (אם לא הניסיון האחרון)
                    if (attempt < retries - 1) {
                        const delay = Math.pow(2, attempt) * 1000; // עיכוב אקספוננציאלי: 1s, 2s, 4s...
                        console.log(`⏱ Waiting ${delay}ms before retry...`);
                        await new Promise(resolve => setTimeout(resolve, delay));
                    }
                }
            }
            throw lastError;
        };
        const response = await fetchWithRetry(lichessApiUrl, {
            headers: {
                Accept: "application/json",
                Authorization: `Bearer ${process.env.LICHESS_PERSONAL_TOKEN}`
            }
        });
        console.log(`📊 Response status: ${response.status}`);
        if (!response.ok) {
            const errorText = await response.text();
            console.log(`❌ Error response: ${errorText}`);
            return res.status(404).json({
                error: "Game not found or not available via API (private or invalid ID)",
            });
        }
        const game = await response.json();
        console.log("Game data structure:", JSON.stringify(game, null, 2).substring(0, 500));
        // המשך הקוד הקיים...
        // טיפול במקרה שהנתונים חסרים
        if (!game.players) {
            return res.status(404).json({
                error: "Game data is incomplete or invalid - missing players"
            });
        }
        // בדיקה של שדה userId - זה המבנה הנכון של הנתונים מ-Lichess
        const whitePlayerId = game.players.white?.userId || "";
        const blackPlayerId = game.players.black?.userId || "";
        console.log(`Looking for player: ${username}`);
        console.log(`White player ID: ${whitePlayerId}`);
        console.log(`Black player ID: ${blackPlayerId}`);
        const lowerUsername = username.toLowerCase();
        const playerColor = whitePlayerId.toLowerCase() === lowerUsername ? "white" :
            blackPlayerId.toLowerCase() === lowerUsername ? "black" :
                "unknown";
        console.log(`Detected player color: ${playerColor}`);
        if (playerColor === "unknown") {
            console.log("Full player data:", JSON.stringify(game.players || {}, null, 2));
            return res.status(404).json({
                error: "Player not found in this game"
            });
        }
        const result = game.winner
            ? game.winner === playerColor
                ? "won"
                : "lost"
            : "draw";
        console.log(`Game result for ${username}: ${result}`);
        // זיהוי האופונט
        const opponentId = playerColor === "white" ? blackPlayerId : whitePlayerId;
        const prompt = `
You are a chess expert AI. Analyze this completed Lichess game for the player "${username}" who played as ${playerColor} and ${result}.

Opening: ${game.opening?.name || "N/A"}
Game result: ${game.status || game.winner ? "Win for " + game.winner : "Draw"}
Opponent: ${opponentId}

Please summarize the player's performance, and give 2-3 improvement suggestions or strengths. Output in natural English.

Keep it short and focused.
`;
        const aiResponse = await (0, GeminiApi_1.askGeminiRaw)(prompt);
        if (!aiResponse) {
            return res.status(500).json({ error: "AI failed to respond" });
        }
        return res.status(200).json({
            username,
            gameId: cleanGameId,
            analysis: aiResponse.trim(),
        });
    }
    catch (err) {
        console.error("❌ analyzeSingleGame failed:", err);
        return res.status(500).json({
            error: "Internal error analyzing game",
            details: err instanceof Error ? err.message : "Unknown error"
        });
    }
};
exports.analyzeSingleGame = analyzeSingleGame;
const detectCheating = async (req, res) => {
    const { gameId, username } = req.params;
    if (!gameId || !username) {
        return res.status(400).json({ error: "Missing gameId or username" });
    }
    try {
        // ניקוי מזהה המשחק
        const cleanGameId = gameId.split('/').pop()?.split('?')[0] || gameId;
        console.log(`🔍 בדיקת רמאות למשחק: ${cleanGameId} עבור שחקן: ${username}`);
        // נמצא את המשתמש ב-DB כדי לקבל את הטוקן שלו
        const playerUser = await user_model_1.default.findOne({ lichessId: username });
        console.log(`🔑 משתמש נמצא: ${playerUser ? "כן" : "לא"}, יש טוקן: ${playerUser?.lichessAccessToken ? "כן" : "לא"}`);
        // נסה למצוא את היריב גם כן (למקרה שאין לנו את הטוקן של השחקן)
        let opponentToken = null;
        if (!playerUser?.lichessAccessToken) {
            // בדיקת מי היריב
            const gameInfo = await tournament_model_1.default.findOne({ "bracket.matches.lichessUrl": { $regex: cleanGameId } });
            if (gameInfo) {
                const matchInfo = gameInfo.bracket.flatMap(b => b.matches).find(m => m.lichessUrl.includes(cleanGameId));
                if (matchInfo) {
                    const opponentId = matchInfo.player1 === username ? matchInfo.player2 : matchInfo.player1;
                    const opponentUser = await user_model_1.default.findOne({ lichessId: opponentId });
                    opponentToken = opponentUser?.lichessAccessToken;
                    console.log(`🔎 נמצא יריב: ${opponentId}, יש טוקן: ${opponentToken ? "כן" : "לא"}`);
                }
            }
        }
        // משתמשים ב-API הנכון להורדת PGN
        const lichessApiUrl = `https://lichess.org/game/export/${cleanGameId}`;
        // יצירת AbortController לקביעת timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 שניות timeout
        // בחירת הטוקן הטוב ביותר שיש לנו
        const authToken = playerUser?.lichessAccessToken || opponentToken || process.env.LICHESS_PERSONAL_TOKEN;
        // הגדרת אפשרויות הבקשה
        const fetchOptions = {
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
                const noAuthOptions = {
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
    }
    catch (err) {
        console.error("❌ שגיאה בזיהוי רמאות:", err);
        return res.status(500).json({
            error: "שגיאה פנימית בניתוח המשחק",
            details: err instanceof Error ? err.message : "שגיאה לא ידועה"
        });
    }
};
exports.detectCheating = detectCheating;
async function processPgn(pgn, cleanGameId, username, res) {
    try {
        // חילוץ מידע מה-PGN
        const headers = {};
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
        const playerColor = whiteName.toLowerCase() === lowerUsername ? "white" :
            blackName.toLowerCase() === lowerUsername ? "black" :
                "unknown";
        console.log(`🎯 זיהוי צבע השחקן: ${playerColor}`);
        if (playerColor === "unknown") {
            return res.status(404).json({
                error: "השחקן לא נמצא במשחק זה"
            });
        }
        // התוצאה - ניצחון, הפסד או תיקו
        const gameResult = result === "1-0" ? (playerColor === "white" ? "won" : "lost") :
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
        const aiResponse = await (0, GeminiApi_1.askGeminiRaw)(prompt);
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
        }
        catch (parseError) {
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
    }
    catch (err) {
        console.error("❌ שגיאה בעיבוד ה-PGN:", err);
        return res.status(500).json({
            error: "שגיאה פנימית בעיבוד נתוני המשחק",
            details: err instanceof Error ? err.message : "שגיאה לא ידועה"
        });
    }
}
// פונקציה נפרדת לשמירת מידע על רמאות שהתגלתה
async function saveCheatingDetection(username, gameId, detectionResult) {
    try {
        // מציאת המשתמש במונגו
        const user = await user_model_1.default.findOne({ lichessId: username });
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
    }
    catch (error) {
        console.error("❌ שגיאה בשמירת מידע על רמאות:", error);
    }
}
exports.default = {
    detectCheating: exports.detectCheating,
    analyzeSingleGame: exports.analyzeSingleGame,
    analyzePlayerStyle: exports.analyzePlayerStyle,
    loginWithLichess,
    lichessCallback,
    autoMatchWithAI,
    joinLobby,
    createTournament: exports.createTournament,
    getTournamentById,
    startTournament,
    getGameResult: exports.getGameResult,
    updateMatchResultByLichessUrl,
};
