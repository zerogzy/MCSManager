import Router from "@koa/router";
import Koa from "koa";

import { logger } from "./service/log";
import "./service/remote_service";
import "./service/user_service";
import "./service/user_statistics";
import "./service/visual_data";

import serviceRouter from "./routers/daemon_router";
import environmentRouter from "./routers/environment_router";
import filemanager_router from "./routers/filemananger_router";
import lowUserRouter from "./routers/general_user_router";
import instanceRouter from "./routers/instance_admin_router";
import exchangeRouter from "./routers/instance_exchange_router";
import userInstanceRouter from "./routers/instance_operate_router";
import javaManagerRouter from "./routers/java_manager_router";
import loginRouter from "./routers/login_router";
import businessUserRouter from "./routers/manage_user_router";
import modManagerRouter from "./routers/mod_manager_router";
import overviewRouter from "./routers/overview_router";
import scheduleRouter from "./routers/schedule_router";
import settingsRouter from "./routers/settings_router";
import ssoRouter from "./routers/sso_router";
import updateRouter from "./routers/update_router";
import userRouter from "./routers/user_overview_router";
import shopUserRouter from "./routers/shop_user_router";
import shopAdminRouter from "./routers/shop_admin_router";
import shopOrderService from "./service/shop_order_service";
import { retryPendingRenewals } from "./service/shop_payment_service";

export function mountRouters(app: Koa<Koa.DefaultState, Koa.DefaultContext>) {
  const apiRouter = new Router({ prefix: "/api" });
  apiRouter.use(overviewRouter.routes()).use(overviewRouter.allowedMethods());
  apiRouter.use(userInstanceRouter.routes()).use(userInstanceRouter.allowedMethods());
  apiRouter.use(instanceRouter.routes()).use(instanceRouter.allowedMethods());
  apiRouter.use(serviceRouter.routes()).use(serviceRouter.allowedMethods());
  apiRouter.use(filemanager_router.routes()).use(filemanager_router.allowedMethods());
  apiRouter.use(businessUserRouter.routes()).use(businessUserRouter.allowedMethods());
  apiRouter.use(loginRouter.routes()).use(loginRouter.allowedMethods());
  apiRouter.use(lowUserRouter.routes()).use(lowUserRouter.allowedMethods());
  apiRouter.use(userRouter.routes()).use(userRouter.allowedMethods());
  apiRouter.use(scheduleRouter.routes()).use(scheduleRouter.allowedMethods());
  apiRouter.use(settingsRouter.routes()).use(settingsRouter.allowedMethods());
  apiRouter.use(ssoRouter.routes()).use(ssoRouter.allowedMethods());
  apiRouter.use(updateRouter.routes()).use(updateRouter.allowedMethods());
  apiRouter.use(environmentRouter.routes()).use(environmentRouter.allowedMethods());
  apiRouter.use(exchangeRouter.routes()).use(exchangeRouter.allowedMethods());
  apiRouter.use(javaManagerRouter.routes()).use(javaManagerRouter.allowedMethods());
  apiRouter.use(modManagerRouter.routes()).use(modManagerRouter.allowedMethods());
  apiRouter.use(shopUserRouter.routes()).use(shopUserRouter.allowedMethods());
  apiRouter.use(shopAdminRouter.routes()).use(shopAdminRouter.allowedMethods());

  app.use(apiRouter.routes()).use(apiRouter.allowedMethods());

  // 启动过期订单清理任务（每 10 分钟删除过期未支付订单）
  setInterval(() => {
    try {
      const count = shopOrderService.deleteExpiredOrders();
      if (count > 0) {
        logger.info(`[Shop] Deleted ${count} expired unpaid order(s).`);
      }
    } catch (err) {
      logger.error("[Shop] Failed to clean expired orders:", err);
    }
  }, 10 * 60 * 1000);

  // 启动待续费订单重试任务（每 5 分钟）
  setInterval(async () => {
    try {
      const count = await retryPendingRenewals();
      if (count > 0) {
        logger.info(`[Shop] Retried ${count} pending renewal(s).`);
      }
    } catch (err) {
      logger.error("[Shop] Failed to retry pending renewals:", err);
    }
  }, 5 * 60 * 1000);
}
