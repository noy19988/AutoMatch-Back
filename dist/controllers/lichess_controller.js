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
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    req.session.codeVerifier = codeVerifier;
    console.log("code_verifier (login):", codeVerifier);
    const authUrl = `${LICHESS_AUTHORIZE_URL}?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}&scope=challenge:write%20board:play%20bot:play&code_challenge=${codeChallenge}&code_challenge_method=S256`;
    res.redirect(authUrl);
};
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
        res.status(400).json({ error: "Missing code_verifier from session" });
        return;
    }
    try {
        console.log("hello");
        const tokenRes = await axios_1.default.post(LICHESS_TOKEN_URL, new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: redirectUri,
            client_id: clientId,
            code_verifier: codeVerifier,
        }), { headers: { "Content-Type": "application/x-www-form-urlencoded" } });
        console.log("token--", tokenRes);
        console.log("code", code);
        const accessToken = tokenRes.data.access_token;
        console.log("accessToken", accessToken);
        const userInfoRes = await axios_1.default.get(LICHESS_ACCOUNT_URL, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        const lichessUser = userInfoRes.data;
        const lichessId = lichessUser.id;
        let user = await user_model_1.default.findOne({ lichessId });
        if (!user) {
            user = await user_model_1.default.create({
                lichessId,
                lichessAccessToken: accessToken,
            });
        }
        else {
            user.lichessAccessToken = accessToken;
            await user.save(); // <-- This saves the token
        }
        const token = jsonwebtoken_1.default.sign({ _id: user._id }, tokenSecret, {
            expiresIn: parseDuration(tokenExpire),
        });
        console.log("redirect", `${frontendUrl}/login?token=${token}&userId=${user._id}&lichessId=${user.lichessId}`);
        res.redirect(`${frontendUrl}/login?token=${token}&userId=${user._id}&lichessId=${user.lichessId}`);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: "Lichess login failed" });
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
        // Proceed with tournament creation
        const tournament = await tournament_model_1.default.create({
            tournamentName, // Save the tournament name
            createdBy,
            playerIds,
            rated: true,
            maxPlayers: parseInt(maxPlayers, 10),
            rounds: [],
            winner: null,
            status: "active", // Mark the new tournament as active
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
const startTournament = async (req, res) => {
    const { id } = req.params;
    const tournament = await tournament_model_1.default.findById(id);
    if (!tournament)
        return res.status(404).json({ error: "Not found" });
    // ✅ Prevent duplicate starts
    if (tournament.rounds.length > 0) {
        return res.status(400).json({ error: "Tournament already started." });
    }
    // ✅ Prevent starting unless lobby is full
    if (tournament.playerIds.length !== tournament.maxPlayers) {
        return res.status(400).json({ error: "Lobby not full" });
    }
    // ✅ Validate creator
    const creator = await user_model_1.default.findById(tournament.createdBy);
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
            const response = await axios_1.default.post("https://lichess.org/api/challenge/open", {
                rated: true, // Set the game to rated
                clock: { limit: 300, increment: 0 },
                variant: "standard",
            }, {
                headers: {
                    Authorization: `Bearer ${creator.lichessAccessToken}`,
                },
            });
            const challenge = response.data;
            matches.push({
                player1: p1,
                player2: p2,
                lichessUrl: `https://lichess.org/${challenge.id}`,
                whiteUrl: challenge.whiteUrl,
                blackUrl: challenge.blackUrl,
                result: "pending",
            });
        }
        catch (err) {
            console.error(`❌ Failed to create game for ${p1} vs ${p2}:`, err);
        }
    }
    const gameUrls = matches.map((m) => m.lichessUrl);
    console.log("🎯 Chess games created:", gameUrls);
    // ✅ Save all matches in round 1
    await tournament_model_1.default.findByIdAndUpdate(tournamentId, { $addToSet: { playerIds: lichessId } }, // avoids duplicates
    { new: true });
    res.json({ message: "Tournament started", matches });
};
// /controllers/lichess_controller.ts
const updateMatchResultByLichessUrl = async (req, res) => {
    try {
        console.log("🔍 Request received to update match:", req.body);
        const { lichessUrl, winner, status } = req.body;
        if (!lichessUrl) {
            console.log("❌ Missing lichessUrl in request body");
            return res.status(400).json({ error: "Missing lichessUrl" });
        }
        console.log(`📝 Attempting to update match with lichessUrl: ${lichessUrl}, winner: ${winner}, status: ${status}`);
        // Find the tournament containing the match
        const tournament = await tournament_model_1.default.findOne({
            "rounds.matches.lichessUrl": lichessUrl,
        });
        if (!tournament) {
            console.log(`❌ No tournament found with match URL: ${lichessUrl}`);
            return res
                .status(404)
                .json({ error: "Tournament not found for this match" });
        }
        console.log(`✅ Found tournament: ${tournament._id}`);
        // Find and update the specific match
        let updated = false;
        let winningPlayerId = null;
        // Loop through tournament rounds to find the match
        for (let roundIndex = 0; roundIndex < tournament.rounds.length; roundIndex++) {
            const round = tournament.rounds[roundIndex];
            for (let matchIndex = 0; matchIndex < round.matches.length; matchIndex++) {
                const match = round.matches[matchIndex];
                if (match.lichessUrl === lichessUrl) {
                    console.log(`✅ Found matching game at round ${roundIndex}, match ${matchIndex}`);
                    // Determine the winning player ID based on winner color
                    if (winner === "white") {
                        winningPlayerId = match.player1;
                    }
                    else if (winner === "black") {
                        winningPlayerId = match.player2;
                    }
                    else {
                        winningPlayerId = "draw";
                    }
                    // Update using MongoDB's positional operator for nested arrays
                    const updatePath = `rounds.${roundIndex}.matches.${matchIndex}`;
                    const updateObj = {};
                    updateObj[`${updatePath}.result`] = status || "completed"; // Use the status as result
                    updateObj[`${updatePath}.winner`] = winningPlayerId; // Store player ID as winner
                    await tournament_model_1.default.updateOne({ _id: tournament._id }, { $set: updateObj });
                    console.log(`✅ Updated match result to status: ${status}, winner: ${winningPlayerId}`);
                    updated = true;
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
            status,
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
