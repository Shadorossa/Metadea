export async function validateExternalId(
  externalId: string,
  _type: string
): Promise<boolean> {
  const [source, id] = externalId.split(":");

  if (!source || !id || isNaN(parseInt(id))) return false;

  try {
    switch (source) {
      case "game":
        return await validateIGDB(parseInt(id));
      case "anime":
      case "manga":
        return await validateAniList(parseInt(id));
      default:
        return false;
    }
  } catch {
    return false;
  }
}

// TODO: Replace with real IGDB API call (#1)
async function validateIGDB(gameId: number): Promise<boolean> {
  return gameId > 0;
}

// TODO: Replace with real AniList GraphQL call (#2)
async function validateAniList(mediaId: number): Promise<boolean> {
  return mediaId > 0;
}
