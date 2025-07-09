export function videoFrameToImage(video: HTMLVideoElement) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const width = (canvas.width = video.offsetWidth);
  const height = (canvas.height = video.offsetHeight);

  ctx.drawImage(video, 0, 0, width, height);

  const image = document.createElement('img');
  image.src = canvas.toDataURL('image/jpeg');

  return image;
}
