/** Facts API */

import { apiFetch } from "./client";

export interface FactInfo {
  id: string;
  content_raw: string;
  content_clean: string;
  characters: string[];
  status: string;
  type: string;
  narrative_weight: string;
  chapter: number;
  timeline: string;
}

export interface ExtractedFactCandidate {
  content_raw: string;
  content_clean: string;
  characters: string[];
  fact_type?: string;
  type?: string;
  narrative_weight: string;
  status: string;
  chapter: number;
  timeline?: string;
}

export interface ExtractFactsResponse {
  facts: ExtractedFactCandidate[];
}

export async function listFacts(auPath: string, status?: string): Promise<FactInfo[]> {
  let url = `/api/v1/facts?au_path=${encodeURIComponent(auPath)}`;
  if (status) url += `&status=${status}`;
  return apiFetch(url);
}

export async function addFact(auPath: string, chapterNum: number, factData: object): Promise<any> {
  return apiFetch("/api/v1/facts", {
    method: "POST",
    body: JSON.stringify({ au_path: auPath, chapter_num: chapterNum, fact_data: factData }),
  });
}

export async function editFact(auPath: string, factId: string, updatedFields: object): Promise<any> {
  return apiFetch(`/api/v1/facts/${factId}`, {
    method: "PUT",
    body: JSON.stringify({ au_path: auPath, updated_fields: updatedFields }),
  });
}

export async function updateFactStatus(auPath: string, factId: string, newStatus: string, chapterNum: number): Promise<any> {
  return apiFetch(`/api/v1/facts/${factId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ au_path: auPath, new_status: newStatus, chapter_num: chapterNum }),
  });
}

export async function extractFacts(auPath: string, chapterNum: number): Promise<ExtractFactsResponse> {
  return apiFetch("/api/v1/facts/extract", {
    method: "POST",
    body: JSON.stringify({ au_path: auPath, chapter_num: chapterNum }),
  });
}
