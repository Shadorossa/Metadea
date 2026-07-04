export function initBio() {
  const bioTextarea = document.getElementById('bio-textarea') as HTMLTextAreaElement | null;
  const bioCharCount = document.getElementById('bio-char-count');
  if (!bioTextarea || !bioCharCount) return;

  const savedBio = localStorage.getItem('metadea_user_bio') || '';
  bioTextarea.value = savedBio;
  bioCharCount.textContent = savedBio.length.toString();

  bioTextarea.addEventListener('input', () => {
    bioCharCount.textContent = bioTextarea.value.length.toString();
    localStorage.setItem('metadea_user_bio', bioTextarea.value);
  });
}
