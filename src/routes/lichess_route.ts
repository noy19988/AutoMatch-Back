import express from "express";
import lichessController from "../controllers/lichess_controller";
import TournamentModel from "../models/tournament_model";

const router = express.Router();

declare global {
  var lichessUserCache: Map<string, { timestamp: number; data: any }>;
}

type Player = {
  id: string;
  username: string;
  rating: number;
  avatar: string;
};

router.get("/login", lichessController.loginWithLichess);
router.get("/callback", lichessController.lichessCallback);
router.get("/matchmaking", lichessController.autoMatchWithAI);


export default router;
