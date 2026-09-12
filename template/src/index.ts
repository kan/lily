/**
 * Worker の入口。**ルーティングも見た目も `config.ts` が組んだアプリが持つ。**
 *
 * 毎日の控え（`runBackup`）を足すときはここに `scheduled` を生やす。手順は
 * README の「Backups」。
 */
import { lily } from './config';

export default lily;
