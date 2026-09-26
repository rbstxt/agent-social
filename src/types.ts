export type VideoSummary = {
  id: string;
  title: string;
  channel: string | null;
  duration: string | null;
  url: string;
  embedUrl: string;
  viewCount: number | null;
  viewCountText: string | null;
  published: string | null;
  verified: boolean;
  descriptionSnippet: string | null;
  badges: string[];
};

export type Chapter = {
  title: string;
  start: string;
  startMs: number;
};

export type VideoInfo = {
  kind: 'video';
  id: string;
  title: string;
  description: string;
  channel: string | null;
  duration: string | null;
  url: string;
  embedUrl: string;
  viewCount: number | null;
  published: string | null;
  verified: boolean;
  hasCaptions: boolean;
  captionLanguages: string[];
  chapters: Chapter[];
};

export type ChannelInfo = {
  kind: 'channel';
  id: string;
  url: string;
  title: string | null;
  handle: string | null;
  subscriberCount: number | null;
  subscriberText: string | null;
  description: string | null;
  verified: boolean;
};

export type TranscriptSegment = {
  text: string;
  startMs: number;
  durationMs: number;
};

export type TranscriptResult = {
  id: string;
  lang: string | null;
  source: 'innertube' | null;
  transcript: string | null;
  segments?: TranscriptSegment[];
  reason?: string;
  truncated?: boolean;
};

export type Frame = { at: number; path: string; width: number; height: number };
export type FrameError = { at: number; error: string };
export type FrameResult = { id: string; frames: Array<Frame | FrameError> };

export type Ok<T> = { ok: true; command: string; data: T };
export type Err = {
  ok: false;
  command: string;
  error: { code: string; message: string; hint?: string };
};
export type Envelope<T> = Ok<T> | Err;

export type RedditPost = {
  id: string;
  subreddit: string | null;
  title: string;
  author: string | null;
  score: number | null;
  scoreText: string | null;
  created: string | null;
  relTime: string | null;
  permalink: string;
  url: string | null;
  commentCount: number | null;
  body: string | null;
  nsfw: boolean;
  spoiler: boolean;
  stickied: boolean;
};

export type RedditComment = {
  id: string;
  author: string | null;
  score: number | null;
  scoreText: string | null;
  created: string | null;
  relTime: string | null;
  body: string;
  permalink: string | null;
  replies: RedditComment[];
  moreCount: number | null;
};

export type RedditThread = {
  post: RedditPost;
  comments: RedditComment[];
  truncated: boolean;
};

export type RedditSearchResult =
  | ({ kind: 'post' } & RedditPost)
  | ({ kind: 'comment' } & RedditComment & { subreddit: string | null; linkTitle: string | null });

export type RedditUser = {
  name: string;
  title: string | null;
  description: string | null;
  karma: number | null;
  created: string | null;
  posts: RedditPost[];
  comments: Array<RedditComment & { subreddit: string | null; linkTitle: string | null }>;
};

export type XAuthor = {
  id: string;
  username: string;
  displayname: string | null;
  verified: boolean;
  protected: boolean;
  followersCount: number | null;
  profileImageUrl: string | null;
};

export type XQuotedTweet = {
  id: string;
  url: string;
  username: string | null;
  text: string;
};

export type XTweet = {
  source: 'x-cookie';
  id: string;
  url: string;
  date: string | null;
  text: string;
  lang: string | null;
  author: XAuthor | null;
  replyCount: number | null;
  retweetCount: number | null;
  likeCount: number | null;
  quoteCount: number | null;
  viewCount: number | null;
  conversationId: string | null;
  inReplyToTweetId: string | null;
  hashtags: string[];
  mentionedUsers: string[];
  links: string[];
  photoCount: number;
  videoCount: number;
  quotedTweet: XQuotedTweet | null;
};

export type XUser = {
  source: 'x-cookie';
  id: string;
  url: string;
  username: string;
  displayname: string | null;
  description: string | null;
  created: string | null;
  followersCount: number | null;
  friendsCount: number | null;
  statusesCount: number | null;
  location: string | null;
  profileImageUrl: string | null;
  protected: boolean;
  verified: boolean;
};

export type XThread = {
  root: XTweet;
  replies: XTweet[];
  truncated: boolean;
};

export type XProfile = {
  user: XUser;
  recentTweets: XTweet[];
};

export type XStatus = {
  authenticated: boolean;
  twscrapeVersion: string | null;
  probe: { handle: string; id: string } | null;
};
