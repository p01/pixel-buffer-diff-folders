import { diffFolders } from "../index";
import { join } from "path";

(async () => {
  const baselineFolder = join("..", "images", "baselines");
  const candidateFolder = join("..", "images", "candidates");
  const diffFolder = join("..", "images", "diff");

  const report = await diffFolders(baselineFolder, candidateFolder, diffFolder, { enableMinimap: true }, true, true);

  console.log(report);
})();