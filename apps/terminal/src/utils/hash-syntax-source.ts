// Content-addressed cache key pieces; djb2 is sufficient because collisions
// only cost a spurious token reuse that the render-time text check rejects.
export const hashSyntaxSource = (text: string): number => {
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0;
  }
  return hash;
};
