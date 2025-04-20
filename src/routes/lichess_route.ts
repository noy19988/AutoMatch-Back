import express from "express";
import lichessController from "../controllers/lichess_controller";
import TournamentModel from "../models/tournament_model";

const router = express.Router();

type Player = {
  id: string;
  username: string;
  rating: number;
  avatar: string;
};

router.get("/login", lichessController.loginWithLichess);
router.get("/callback", lichessController.lichessCallback);
router.get("/matchmaking", lichessController.autoMatchWithAI);
router.post(
  "/tournaments/:id/join",
  lichessController.joinLobby as express.RequestHandler
);
router.post(
  "/tournaments",
  lichessController.createTournament as express.RequestHandler
);
router.get("/tournaments/:id", (async (
  req: express.Request,
  res: express.Response
) => {
  try {
    const tournament = await TournamentModel.findById(req.params.id);
    if (!tournament) {
      return res.status(404).json({ error: "Tournament not found" });
    }
    const data = tournament.toObject();
    const enrichedPlayers = await Promise.all(
      data.playerIds.map(async (player: any) => {
        const id = typeof player === "string" ? player : player.id;
        if (!id || typeof id !== "string") return null;

        try {
          const userRes = await fetch(
            `https://lichess.org/api/user/${encodeURIComponent(id)}`
          );
          const userData = await userRes.json();
          return {
            id: id, // Ensure id is a string
            username: userData.username,
            rating: userData.perfs?.blitz?.rating ?? 1500,
            avatar: "/placeholder.svg",
          };
        } catch {
          return {
            id: id, // Ensure id is a string
            username: id,
            rating: 1500,
            avatar: "/placeholder.svg",
          };
        }
      })
    );
    const filteredPlayers = enrichedPlayers.filter(
      (p): p is Player => p !== null
    );
    res.json({
      ...data,
      maxPlayers: data.maxPlayers,
      playerIds: filteredPlayers.map((player) => player.id), // Ensure playerIds are strings
    });
  } catch (err) {
    console.error("❌ Failed to fetch tournament:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}) as express.RequestHandler);
router.post(
  "/tournaments/:id/start",
  lichessController.startTournament as express.RequestHandler
);

export default router;
