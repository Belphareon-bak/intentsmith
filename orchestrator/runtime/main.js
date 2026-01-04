import { startHttpRunServer } from "./http-run.js";
import { recoverExecutionsOnBoot } from "./state/recover-executions.js";

recoverExecutionsOnBoot();

startHttpRunServer(3335);
