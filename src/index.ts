const { Worker } = require("worker_threads");
import { Changed, Error, DiffImageOptions, Report } from "./types";
import { diffImage } from "./diffImageAsync";
import * as fs from "fs";
import { dirname, join, sep } from "path";
import { Options } from "pixel-buffer-diff";
import * as os from "os";

const listImagesInFolder = (path: string, pathAndSepLength: number = (path + sep).length): string[] => {
  const foo: string[] = [];
  const pathWithSep = path + sep;
  const relPath = pathWithSep.slice(pathAndSepLength);

  const dirents = fs.readdirSync(path, {withFileTypes: true });
  for (const dirent of dirents) {
    const name = dirent.name;
    const lowerCaseExtenstion = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
    if (dirent.isDirectory()) {
      foo.push.apply(foo, listImagesInFolder(join(path, name), pathAndSepLength));
    } else if(dirent.isFile() && (lowerCaseExtenstion === "png" || lowerCaseExtenstion === "jpg" || lowerCaseExtenstion === "jpeg")) {
      foo.push(relPath + name);
    }
  }

  return foo;
};

export const diffFolders = async (baselineFolder: string, candidateFolder: string, diffFolder: string,
  options: Options, sideBySide: boolean, runAsync: boolean = false): Promise<Report> => {

  const timeStart = Date.now();
  const report: Report = {
    changed: [],
    unchanged: [],
    added: [],
    removed: [],
    error: []
  };

  const baselineImageRelPaths = listImagesInFolder(baselineFolder).sort();
  const candidateImageRelPaths = listImagesInFolder(candidateFolder).sort();
  fs.mkdirSync(dirname(diffFolder), { recursive: true });
 
  const bil = baselineImageRelPaths.length;
  const cil = candidateImageRelPaths.length;

  // Go through the baseline and candidate image relPaths
  let bi = 0;
  let ci = 0;
  const irpBoth: string[] = [];
  while (bi + ci < bil + cil) {
    const birp = baselineImageRelPaths[bi] || "";
    const cirp = candidateImageRelPaths[ci] || "";
    if (bi === bil) {
      report.added.push(cirp);
      ci++;
    } else if (ci === cil) {
      report.removed.push(birp);
      bi++;
    } else if (birp < cirp) {
      report.removed.push(birp);
      bi++;
    } else if (cirp < birp) {
      report.added.push(cirp);
      ci++;
    } else if (birp === cirp) {
      irpBoth.push(birp);
      bi++;
      ci++;
    }
  }

  const numOfCpus = os.cpus().length;
  const numOfWorkers = runAsync ? Math.ceil(numOfCpus * .75) : 1;

  console.log(`⚡ pixel-buffer-diff-folders
${bil + cil} unique image relative paths
${bil} baseline
${cil} candidate
-${report.removed.length}+${report.added.length}
...diffing ${irpBoth.length * 2} common images using ${numOfWorkers} worker(s)`);

  if (numOfWorkers > 1) {
    let imageIndex = 0;
    const diffImageWorker = async () => {
      const worker = new Worker("./diffImageAsync.js");

      const diffImageOptions: DiffImageOptions = {
        baselineFolder, candidateFolder, diffFolder,
        options, sideBySide, path: ""
      };

      while (diffImageOptions.path = irpBoth[imageIndex++]) {
        await new Promise((resolve) => {
            worker.once("message", (changedOrError: Changed | Error) => {
              if ("error" in changedOrError) {
                report.error.push(changedOrError);
              } else if (changedOrError.diff > 0) {
                report.changed.push(changedOrError);
              } else {
                report.unchanged.push(changedOrError.path);
              }
      
              resolve(undefined);
            });

            worker.postMessage(diffImageOptions);
          });

      };

      worker.terminate();
      return;
    };

    const buckets = new Array(numOfWorkers).fill(1);
    await Promise.all(buckets.map(diffImageWorker));
  } else {
    const diffImageOptions: DiffImageOptions = {
      baselineFolder, candidateFolder, diffFolder,
      options, sideBySide, path: ""
    };

    for (let imageIndex = 0; imageIndex < irpBoth.length; imageIndex++) {
      diffImageOptions.path = irpBoth[imageIndex];
      const changedOrError = await diffImage(diffImageOptions);

      if ("error" in changedOrError) {
        report.error.push(changedOrError);
      } else if (changedOrError.diff > 0) {
        report.changed.push(changedOrError);
      } else {
        report.unchanged.push(diffImageOptions.path);
      }
    }
  }

  const duration = Date.now() - timeStart;
  console.log(
    `load, decode & diff ${irpBoth.length * 2} images + encode & save ${report.changed.length
    } images in ${duration / 1000}s`
  );

  return report;
}
