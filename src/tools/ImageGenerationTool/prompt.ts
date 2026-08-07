export const IMAGE_GENERATION_TOOL_NAME = "ImageGeneration";

export function getImageGenerationPrompt(): string {
  return `
- Allows Maximo to generate images using the connected Maximo AI backend's image generation tool
- Generates images via the backend (Maximo AI API / MyTabulon) in a single API call
- Use this tool when the user asks for an image, illustration, logo, concept art, or any visual asset
- Returns the generated image URL(s) which Maximo should present to the user as markdown links/images

Usage notes:
  - Provide a detailed, descriptive prompt for best results (subject, style, composition, lighting)
  - Optional: aspect_ratio (e.g. "16:9", "1:1", "4:3"), size ("1K", "2K", "4K"), output count
  - After generating, include the image in your response using markdown: ![description](exact_url_from_tool_result)
  - CRITICAL: You MUST copy the URL(s) exactly as returned in the tool result text (lines like "Image 1 URL: https://..."). NEVER invent, guess, or reconstruct a URL. If you use any hallucinated or reconstructed URL the image will be broken.
  - Use the full URL exactly as returned - verbatim, one markdown image per URL. Do NOT shorten, re-encode, or change any part of it.
`;
}
