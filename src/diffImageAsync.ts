const { isMainThread, parentPort } = require("worker_threads");
import { Changed, Error, DiffImageOptions } from "./types";
import * as fs from "fs";
import { join, dirname } from "path";
import { decode } from "jpeg-js";
import { diffImageDatas } from "pixel-buffer-diff";
import * as fastPng from "fast-png";

const loadFileAndGetRGBAImageData = async (path: string): Promise<ImageData> => {
  const isPNG = path.endsWith(".png");
  const imageBuffer = await fs.promises.readFile(path);
  const decodeImage = (isPNG ? fastPng.decode : decode);
  const imageData = decodeImage(imageBuffer) as ImageData;

  const data = imageData.data;
  const area = imageData.width * imageData.height;
  const length = data.length;

  if (length === area * 4) {
    return imageData;
  }

  const imageDataRGBA = { width: imageData.width, height: imageData.height, data: new Uint8ClampedArray(area  * 4) } as ImageData;
  const rgbaData = imageDataRGBA.data;
  for (let i = 0, j = 0; i < length;) {
    rgbaData[j++] = data[i++];
    rgbaData[j++] = data[i++];
    rgbaData[j++] = data[i++];
    rgbaData[j++] = 255;
  }

  return imageDataRGBA;
};

export const diffImage = async (data: DiffImageOptions): Promise<Changed | Error> => {
  const { baselineFolder, candidateFolder, diffFolder, options, sideBySide, path } = data;
  try {
    const baselinePath = join(baselineFolder, path);
    const candidatePath = join(candidateFolder, path);
    const diffPath = join(diffFolder, path);

    const [baselineImageData, candidateImageData] = await Promise.all([
      loadFileAndGetRGBAImageData(baselinePath),
      loadFileAndGetRGBAImageData(candidatePath)
    ]);
    
    const widthMultiplier = sideBySide ? 3 : 1;
    const { width, height } = baselineImageData;
    const difxPng: ImageData = {
      width: width * widthMultiplier,
      height,
      data: new Uint8ClampedArray(width * widthMultiplier * height * 4),
    };

    const result = diffImageDatas(baselineImageData, candidateImageData, difxPng, options);
    const change: Changed = Object.assign(result, { path });

    if (result.diff > 0) {
      const pngBuffer = fastPng.encode(difxPng as fastPng.ImageData);
      fs.mkdirSync(dirname(diffPath), { recursive: true });
      fs.writeFileSync(diffPath, pngBuffer);
    }

    return change;
  } catch (err) {
    return { path, error: `${err}` };
  }
};

if (!isMainThread) {
  (async () => {
    return new Promise(() => {
      // No resolve in worker thread: The parent thread will postMessage and terminate the worker thread
      parentPort.on("message", async (data: DiffImageOptions) => {
        const changeOrError = await diffImage(data);
        parentPort.postMessage(changeOrError);
      });
    });
  })();
}
