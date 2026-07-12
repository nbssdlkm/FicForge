// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Engine fandom query/command layer — UI 薄转发层。
 *
 * R4 架构维 HIGH 治本（E3）：目录布局手拼、fandom 文件裸读写、删除路径的
 * 锁序/回收站/向量卸载/别名失效/密钥清理编排已全部下沉引擎 services/fandom_service.ts。
 * 本文件只做 getEngine() 绑定与既有签名兼容。
 */

import {
  createAu as engineCreateAu,
  createFandom as engineCreateFandom,
  deleteAu as engineDeleteAu,
  deleteFandom as engineDeleteFandom,
  getFandomDisplayInfo as engineGetFandomDisplayInfo,
  listAus as engineListAus,
  listFandomFiles as engineListFandomFiles,
  listFandoms as engineListFandoms,
  readFandomFile as engineReadFandomFile,
} from "@ficforge/engine";
import { getEngine } from "./engine-instance";
import type { AuInfo, FandomDisplayInfo, FandomInfo } from "./fandoms";

export async function listFandoms(): Promise<FandomInfo[]> {
  return engineListFandoms(getEngine());
}

export async function getFandomDisplayInfo(fandomPath: string): Promise<FandomDisplayInfo> {
  return engineGetFandomDisplayInfo(getEngine(), fandomPath);
}

export async function createFandom(name: string) {
  return engineCreateFandom(getEngine(), name);
}

export async function listAus(fandomDirName: string): Promise<AuInfo[]> {
  return engineListAus(getEngine(), fandomDirName);
}

export async function createAu(fandomName: string, auName: string, fandomPath: string) {
  return engineCreateAu(getEngine(), fandomName, auName, fandomPath);
}

export async function deleteFandom(fandomDirName: string) {
  return engineDeleteFandom(getEngine(), fandomDirName);
}

export async function deleteAu(fandomDirName: string, auName: string) {
  return engineDeleteAu(getEngine(), fandomDirName, auName);
}

export async function listFandomFiles(fandomName: string) {
  return engineListFandomFiles(getEngine(), fandomName);
}

export async function readFandomFile(fandomName: string, category: string, filename: string) {
  return engineReadFandomFile(getEngine(), fandomName, category, filename);
}
