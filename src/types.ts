import { Options, Result } from "pixel-buffer-diff";

export type Changed = { path: string } & Result;
export type Error = { path: string, error: string };

export type DiffFoldersOptions = {
  baselineFolder: string, candidateFolder: string, diffFolder: string,
  options: Options, sideBySide: boolean
};

export type DiffImageOptions = { path: string } & DiffFoldersOptions;

export type Report = {
  changed: Changed[];
  unchanged: string[];
  added: string[];
  removed: string[];
  error: Error[];
};

