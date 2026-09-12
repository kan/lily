/**
 * The Worker's entry point. **Both the routing and the look belong to the app that
 * `config.ts` builds.**
 *
 * Adding the daily backup (`runBackup`) means growing a `scheduled` handler here; the
 * steps are under "Backups" in the README.
 */
import { lily } from './config';

export default lily;
