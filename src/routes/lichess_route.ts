import express from "express";
import lichessController from "../controllers/lichess_controller";

const router = express.Router();

router.get("/login", lichessController.loginWithLichess);
router.get("/callback", lichessController.lichessCallback);

export default router;
