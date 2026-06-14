import Router from "@koa/router";
import { ROLE } from "../entity/user";
import permission from "../middleware/permission";
import { operationLogger } from "../service/operation_logger";
import { panelUpdateService } from "../service/update_service";

const router = new Router({ prefix: "/update" });

router.post("/check", permission({ level: ROLE.ADMIN }), async (ctx) => {
  const result = await panelUpdateService.checkUpdate();
  operationLogger.log("system_config_change", {
    operator_ip: ctx.ip,
    operator_name: ctx.session?.["userName"]
  });
  ctx.body = result;
});

router.post("/start", permission({ level: ROLE.ADMIN }), async (ctx) => {
  const result = await panelUpdateService.startUpdate();
  operationLogger.log("system_config_change", {
    operator_ip: ctx.ip,
    operator_name: ctx.session?.["userName"]
  });
  ctx.body = result;
});

router.get("/status", permission({ level: ROLE.ADMIN }), async (ctx) => {
  ctx.body = panelUpdateService.getStatus();
});

export default router;
