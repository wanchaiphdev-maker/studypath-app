import { Router } from "express";
import { requireAuth } from "../auth";
import { leaderboard } from "../services/contest";

const router = Router();

router.get("/:id/leaderboard", requireAuth(), async (req, res) => {
	const result = await leaderboard(String(req.params.id));
	return res.json(result);
});

export default router;
