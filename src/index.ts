const {
  Worker, isMainThread, parentPort
} = require("worker_threads");

import * as fs from "fs";
import * as fastGlob from "fast-glob";
import { join, dirname } from "path";
import { decode } from "jpeg-js";
import { diff, Options, Result } from "pixel-buffer-diff";
import * as fastPng from "fast-png";
import * as os from "os";

export type Changed = { path: string } & Result;

type MessageToWorker = { path: string, baselineFolder: string, candidateFolder: string, diffFolder: string,
  options: Options, sideBySide: boolean };


export type Report = {
  changed: Changed[];
  unchanged: string[];
  added: string[];
  removed: string[];
};

const report: Report = {
  changed: [],
  unchanged: [],
  added: [],
  removed: [],
};

const getRGBABuffer = (imageData: ImageData): Uint8ClampedArray => {
  const data = imageData.data;
  const area = imageData.width * imageData.height;
  const length = data.length;

  if (length === area * 4) {
    return imageData.data;
  }

  const rgbaData = new Uint8ClampedArray(area * 4);
  for (let i = 0, j = 0; i < length;) {
    rgbaData[j++] = data[i++];
    rgbaData[j++] = data[i++];
    rgbaData[j++] = data[i++];
    rgbaData[j++] = 255;
  }
  return rgbaData;
};

export const diffFolders = async (baselineFolder: string, candidateFolder: string, diffFolder: string, options: Options, sideBySide: boolean = false) => {
  const timeStart = Date.now();
  const pattern = "**/*.@(png|jpe?g)";
  const baselineImageRelPaths = fastGlob.sync(pattern, { cwd: baselineFolder }).sort();
  const candidateImageRelPaths = fastGlob.sync(pattern, { cwd: candidateFolder }).sort();
  fs.mkdirSync(dirname(diffFolder), { recursive: true });


  const bil = baselineImageRelPaths.length;
  const cil = candidateImageRelPaths.length;

  console.log(`${bil + cil} unique images: ${bil} baseline ⚡ ${cil} candidate`);

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

  console.log(
    `${irpBoth.length * 2} images in common, ${report.removed.length
    } images removed and ${report.added.length} images added`
  );

  let imageIndex = 0;
  const diffNextImageAsync = async () => {
    const worker = new Worker(__filename, { stdout: true });

    let path: string;
    while (path = irpBoth[imageIndex++]) {
      await new Promise((resolve) => {
        worker.once("message", (msg?: Changed | {error: string}) => {
          if (msg) {
            if ("error" in msg) {
              console.log(`** error ** ${msg.error}`);
            } else {
              report.changed.push(msg);
            }
          } else {
            report.unchanged.push(path);
          }
          resolve(undefined);
        });
        // worker.on("error", reject);

        worker.postMessage({ path, baselineFolder, candidateFolder, diffFolder, options, sideBySide });
      });
    };

    worker.terminate();
  };

  const buckets = [];
  const numOfCpus = os.cpus().length;
  const numOfWorkers = Math.ceil(numOfCpus * .75);
  for (let i = 0; i < numOfWorkers; i++) {
    buckets.push(diffNextImageAsync());
  };
  console.log(`... diffing ${irpBoth.length * 2} images in ${numOfWorkers} workers`);
  await Promise.all(buckets);

  const duration = Date.now() - timeStart;
  console.log(
    `load, decode & diff ${irpBoth.length * 2} images + encode & save ${report.changed.length
    } images in ${duration / 1000}s`
  );

  return report;
}

// Worker thread
if (!isMainThread) {
  (async () => {
    const diffImage = (data: MessageToWorker) => {
      const irp = data.path;
      const { baselineFolder, candidateFolder, diffFolder, options, sideBySide } = data;
      const isPNG = irp.endsWith(".png");
      const decodeImage = isPNG ? fastPng.decode : decode;

      const baselinePath = join(baselineFolder, irp);
      const candidatePath = join(candidateFolder, irp);
      const diffPath = join(diffFolder, irp);

      const baselineImageBuffer = fs.readFileSync(baselinePath);
      const candidateImageBuffer = fs.readFileSync(candidatePath);

      const baselineImage = (decodeImage(
        baselineImageBuffer
      ) as unknown) as ImageData;
      const candidateImage = (decodeImage(
        candidateImageBuffer
      ) as unknown) as ImageData;

      // Check if we got RGB buffers instead of RGBA
      const bidRGBA = getRGBABuffer(baselineImage);
      const cidRGBA = getRGBABuffer(candidateImage);

      const widthMultiplier = sideBySide ? 3 : 1;
      const { width, height } = baselineImage;
      const difxPng: ImageData = {
        width: width * widthMultiplier,
        height,
        data: new Uint8ClampedArray(width * widthMultiplier * height * 4),
      };

      try {
        const result = diff(bidRGBA, cidRGBA, difxPng.data, width, height, options);

        if (result.diff === 0) {
          parentPort.postMessage(undefined);
        } else {
          const change: Changed = Object.assign(result, { path: irp });

          const pngBuffer = fastPng.encode(difxPng as fastPng.IImageData);

          fs.mkdirSync(dirname(diffPath), { recursive: true });

          fs.writeFileSync(diffPath, pngBuffer);

          parentPort.postMessage(change);
        }
      } catch (err) {
        console.log(err);
        parentPort.postMessage({error: `${err}`});
      }
    };

    return new Promise(() => {
      parentPort.on("message", (data: MessageToWorker) => {
        diffImage(data);
      });
    });

  })();
}
