export interface SeriesRow {
  coord: string;
  title: string;
  summary: string;
  free: number;
  curator: string;
  slug: string;
}
export interface CutRow {
  id: string;
  coord: string;
  episode: number;
  title: string;
  duration: number;
  price: number;
  hls_url: string | null;
  curator: string;
  series_slug: string;
}
