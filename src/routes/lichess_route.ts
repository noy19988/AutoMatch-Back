import express from "express";
import lichessController from "../controllers/lichess_controller";

const router = express.Router();

router.get("/login", lichessController.loginWithLichess);
router.get("/callback", lichessController.lichessCallback);
router.get("/matchmaking", lichessController.autoMatchWithAI);

export default router;
