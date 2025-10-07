import "express";
import type { File as MulterFile } from "multer";

declare global {
  namespace Express {
    interface Request {
      file?: MulterFile;
      files?: MulterFile[] | Record<string, MulterFile[]>;
    }
  }
}

export {};
