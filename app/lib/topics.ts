export const CURATD_TOPICS = [
  "Philosophy",
  "Technology",
  "Business",
  "Science",
  "Comedy",
  "Politics",
  "Health & Fitness",
  "Psychology",
  "History",
  "Economics",
  "Startups",
  "Music",
  "Film",
  "Sports",
  "Education",
  "Art & Design",
  "Food",
  "Travel",
  "Self Improvement",
  "Spirituality",
] as const;

export type CuratdTopic = (typeof CURATD_TOPICS)[number];
