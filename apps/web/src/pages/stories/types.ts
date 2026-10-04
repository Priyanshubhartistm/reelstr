export interface Story {
  coord: string;
  title: string;
  logline: string;
  pubkey: string;
  d: string;
}
export interface SceneRow {
  id: string;
  title: string;
  content: string;
  video_sha: string;
  video_url: string;
  duration: number;
  license: string;
  author: string;
  parent_id: string | null;
  eligible: boolean;
  gen: string;
}
