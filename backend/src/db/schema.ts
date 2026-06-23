export interface User {
  id: string;
  username: string;
  email: string;
  createdAt: number;
}

export interface LibraryItem {
  id: string;
  userId: string;
  externalId: string; // "game:123" o "anime:456"
  type: string; // game, anime, manga, etc
  title: string;
  cover: string;
  status: string; // planning, currently, completed, paused, dropped
  rating: number | null;
  createdAt: number;
  updatedAt: number;
}
