(function () {
  function _px(x, y, c, S) {
    return `<rect x="${x * S}" y="${y * S}" width="${S}" height="${S}" fill="${c}"/>`;
  }
  function _bk(x, y, w, h, c, S) {
    return `<rect x="${x * S}" y="${y * S}" width="${w * S}" height="${h * S}" fill="${c}"/>`;
  }
  function _svg(bg, draws, size) {
    const S = size / 16;
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg" style="image-rendering:pixelated">
      <rect width="${size}" height="${size}" rx="${size * 0.075}" fill="${bg}"/>
      ${draws(S)}
    </svg>`;
  }

  const CHARS = [
    {
      id: 'robot', nameAr: 'الروبوت', nameEn: 'Robot',
      descAr: 'منطقي، دقيق، يحل المشاكل بطريقة علمية',
      descEn: 'Logical, precise, solves problems scientifically',
      color: '#4cc9f0', bg: '#0a1628',
      draw: (S) => [
        _bk(7,0,2,2,'#8d99ae',S), _bk(6,1,4,1,'#8d99ae',S),
        _bk(3,2,10,8,'#8d99ae',S), _bk(4,3,8,6,'#adb5bd',S),
        _bk(5,4,2,2,'#4cc9f0',S), _bk(9,4,2,2,'#4cc9f0',S), _px(5,4,'#7ee8fa',S), _px(9,4,'#7ee8fa',S),
        _bk(5,8,6,1,'#6c757d',S), _px(5,8,'#4cc9f0',S), _px(7,8,'#4cc9f0',S), _px(9,8,'#4cc9f0',S),
        _bk(2,10,12,5,'#8d99ae',S), _bk(3,11,10,3,'#6c757d',S),
        _px(5,12,'#9d4edd',S), _px(7,12,'#4cc9f0',S), _px(9,12,'#9d4edd',S),
        _bk(4,15,3,1,'#8d99ae',S), _bk(9,15,3,1,'#8d99ae',S)
      ].join('')
    },
    {
      id: 'ninja', nameAr: 'النينجا', nameEn: 'Ninja',
      descAr: 'سريع، صامت، يضرب ويختفي',
      descEn: 'Fast, silent, strikes and vanishes',
      color: '#9d4edd', bg: '#0d0d0d',
      draw: (S) => [
        _bk(4,1,8,2,'#1a1a2e',S), _bk(3,3,10,7,'#1a1a2e',S),
        _bk(3,3,10,2,'#9d4edd',S), _px(3,3,'#c77dff',S), _px(12,3,'#c77dff',S),
        _bk(5,6,2,1,'#e9ecef',S), _bk(9,6,2,1,'#e9ecef',S),
        _bk(3,8,10,2,'#2d2d4a',S),
        _bk(2,10,12,1,'#1a1a2e',S), _bk(3,11,10,4,'#1a1a2e',S), _bk(5,11,6,2,'#2d2d4a',S),
        _bk(4,13,8,1,'#9d4edd',S), _px(7,13,'#c77dff',S), _px(8,13,'#c77dff',S),
        _bk(4,14,3,2,'#1a1a2e',S), _bk(9,14,3,2,'#1a1a2e',S)
      ].join('')
    },
    {
      id: 'wizard', nameAr: 'الساحر', nameEn: 'Wizard',
      descAr: 'غامض، إبداعي، عنده قدرات خارقة',
      descEn: 'Mysterious, creative, with extraordinary powers',
      color: '#c77dff', bg: '#0f0520',
      draw: (S) => [
        _bk(7,0,2,1,'#7209b7',S), _bk(6,1,4,2,'#7209b7',S), _bk(5,3,6,3,'#9d4edd',S), _bk(3,6,10,1,'#c77dff',S),
        _px(6,2,'#ffd60a',S), _px(10,4,'#ffd60a',S), _px(5,5,'#ffd60a',S),
        _bk(4,7,8,5,'#ffd6b3',S),
        _bk(5,9,2,1,'#1a1a2e',S), _bk(9,9,2,1,'#1a1a2e',S),
        _bk(5,11,6,1,'#e9ecef',S), _bk(4,12,8,1,'#adb5bd',S),
        _bk(3,12,10,4,'#7209b7',S), _bk(4,13,8,2,'#9d4edd',S),
        _px(7,13,'#ffd60a',S), _px(8,13,'#ffd60a',S),
        _bk(2,12,2,3,'#7209b7',S), _bk(12,12,2,3,'#7209b7',S)
      ].join('')
    },
    {
      id: 'alien', nameAr: 'الكائن الفضائي', nameEn: 'Alien',
      descAr: 'غريب، مميز، لا أحد يفهمه',
      descEn: 'Weird, unique, nobody understands them',
      color: '#2ec4b6', bg: '#001a0f',
      draw: (S) => [
        _bk(5,1,6,1,'#2ec4b6',S), _bk(4,2,8,1,'#2ec4b6',S), _bk(3,3,10,6,'#2ec4b6',S), _bk(4,9,8,2,'#2ec4b6',S),
        _bk(5,0,1,2,'#06d6a0',S), _bk(10,0,1,2,'#06d6a0',S), _px(4,0,'#7fffd4',S), _px(11,0,'#7fffd4',S),
        _bk(4,4,3,3,'#1a1a2e',S), _bk(9,4,3,3,'#1a1a2e',S),
        _bk(5,5,1,1,'#4cc9f0',S), _bk(10,5,1,1,'#4cc9f0',S),
        _bk(6,10,4,1,'#06d6a0',S),
        _bk(4,11,8,4,'#2ec4b6',S), _bk(5,12,6,2,'#1dc4b6',S),
        _bk(4,15,3,1,'#2ec4b6',S), _bk(9,15,3,1,'#2ec4b6',S)
      ].join('')
    },
    {
      id: 'fox', nameAr: 'الثعلب', nameEn: 'Fox',
      descAr: 'ذكي، محتال، يستغل كل فرصة',
      descEn: 'Smart, cunning, exploits every opportunity',
      color: '#ff8c42', bg: '#1a0a00',
      draw: (S) => [
        _bk(3,0,3,3,'#ff8c42',S), _bk(10,0,3,3,'#ff8c42',S), _px(4,1,'#ffb380',S), _px(11,1,'#ffb380',S),
        _bk(3,3,10,7,'#ff8c42',S),
        _bk(5,5,6,4,'#f5f5f5',S), _bk(4,6,8,3,'#f5f5f5',S),
        _bk(5,5,2,2,'#1a1a2e',S), _bk(9,5,2,2,'#1a1a2e',S), _px(5,5,'#ff8c42',S), _px(9,5,'#ff8c42',S),
        _bk(7,8,2,1,'#e63946',S),
        _bk(4,10,8,5,'#ff8c42',S), _bk(5,11,6,3,'#ffb380',S),
        _bk(12,12,2,3,'#ff8c42',S), _px(13,12,'#ffd60a',S),
        _bk(4,15,3,1,'#ff8c42',S), _bk(9,15,3,1,'#ff8c42',S)
      ].join('')
    },
    {
      id: 'ghost', nameAr: 'الشبح', nameEn: 'Ghost',
      descAr: 'هادي، غامض، يتجنب الناس',
      descEn: 'Quiet, mysterious, avoids people',
      color: '#4cc9f0', bg: '#050510',
      draw: (S) => [
        _bk(5,1,6,1,'#c8d6e5',S), _bk(4,2,8,1,'#dde6f0',S), _bk(3,3,10,8,'#dde6f0',S),
        _bk(3,11,2,2,'#dde6f0',S), _bk(7,11,2,2,'#dde6f0',S), _bk(11,11,2,2,'#dde6f0',S),
        _bk(5,12,2,2,'#dde6f0',S), _bk(9,12,2,2,'#dde6f0',S),
        _bk(5,5,2,3,'#4cc9f0',S), _bk(9,5,2,3,'#4cc9f0',S), _px(5,5,'#7ee8fa',S), _px(9,5,'#7ee8fa',S),
        _bk(6,9,4,1,'#adb5bd',S), _px(6,9,'#c8d6e5',S), _px(9,9,'#c8d6e5',S),
        _bk(4,8,2,1,'#ff6b9d',S), _bk(10,8,2,1,'#ff6b9d',S),
        _px(7,1,'#ffffff',S), _px(8,1,'#ffffff',S)
      ].join('')
    },
    {
      id: 'knight', nameAr: 'الفارس', nameEn: 'Knight',
      descAr: 'منضبط، شجاع، يواجه المشاكل مباشرة',
      descEn: 'Disciplined, brave, faces problems head-on',
      color: '#4361ee', bg: '#071020',
      draw: (S) => [
        _bk(4,1,8,2,'#4361ee',S), _bk(3,3,10,5,'#4361ee',S), _bk(4,4,8,3,'#3a56d4',S),
        _bk(5,6,6,1,'#4cc9f0',S), _px(5,6,'#7ee8fa',S), _px(10,6,'#7ee8fa',S),
        _bk(7,0,2,2,'#e63946',S),
        _bk(3,8,10,6,'#4361ee',S), _bk(4,9,8,4,'#3a56d4',S),
        _bk(7,10,2,2,'#ffd60a',S),
        _bk(2,8,2,3,'#4361ee',S), _bk(12,8,2,3,'#4361ee',S),
        _bk(4,14,3,2,'#3a56d4',S), _bk(9,14,3,2,'#3a56d4',S)
      ].join('')
    },
    {
      id: 'scientist', nameAr: 'العالم', nameEn: 'Scientist',
      descAr: 'فضولي، دقيق، يحب التجارب والاكتشافات',
      descEn: 'Curious, precise, loves experiments and discoveries',
      color: '#ffd60a', bg: '#001520',
      draw: (S) => [
        _bk(3,1,2,3,'#ffd60a',S), _bk(11,1,2,3,'#ffd60a',S), _bk(4,0,8,3,'#ffd60a',S),
        _px(3,0,'#fff3b0',S), _px(12,0,'#fff3b0',S),
        _bk(4,3,8,5,'#ffd6b3',S),
        _bk(4,4,4,2,'#2d2d4a',S), _bk(8,4,4,2,'#2d2d4a',S),
        _bk(5,4,2,2,'#4cc9f0',S), _bk(9,4,2,2,'#4cc9f0',S),
        _bk(7,5,2,1,'#2d2d4a',S), _px(5,4,'#7ee8fa',S), _px(9,4,'#7ee8fa',S),
        _bk(3,4,1,1,'#6c757d',S), _bk(12,4,1,1,'#6c757d',S),
        _bk(6,7,4,1,'#1a1a2e',S),
        _bk(3,8,10,7,'#e9ecef',S), _bk(4,9,8,5,'#ffffff',S),
        _bk(3,9,2,4,'#dee2e6',S), _bk(11,9,2,4,'#dee2e6',S),
        _bk(10,11,2,2,'#dee2e6',S), _px(10,11,'#4cc9f0',S)
      ].join('')
    },
    {
      id: 'hacker', nameAr: 'الهاكر', nameEn: 'Hacker',
      descAr: 'يدور الثغرات، يفكر خارج الصندوق',
      descEn: 'Finds loopholes, thinks outside the box',
      color: '#3a86ff', bg: '#000000',
      draw: (S) => [
        _bk(3,1,10,4,'#1a1a2e',S), _bk(2,5,12,9,'#1a1a2e',S),
        _bk(3,1,3,5,'#13132a',S), _bk(10,1,3,5,'#13132a',S),
        _bk(5,3,6,5,'#2d2d4a',S), _bk(5,4,6,3,'#001a3e',S),
        _bk(6,5,2,1,'#4cc9f0',S), _bk(8,5,2,1,'#4cc9f0',S),
        _bk(6,7,4,1,'#3a86ff',S),
        _bk(7,6,1,3,'#6c757d',S), _bk(8,6,1,3,'#6c757d',S),
        _bk(4,10,8,4,'#1a1a2e',S), _bk(5,11,6,2,'#13132a',S),
        _bk(4,13,8,2,'#0a0a1a',S), _bk(5,13,6,1,'#3a86ff',S),
        _px(6,13,'#4cc9f0',S), _px(8,13,'#4cc9f0',S), _px(10,13,'#4cc9f0',S)
      ].join('')
    },
  ];

  window.AVATARS = {
    chars: CHARS,

    getById(id) {
      return CHARS.find(c => c.id === id) || null;
    },

    renderSVG(id, size = 64) {
      const ch = this.getById(id);
      if (!ch) return `<div style="width:${size}px;height:${size}px;border-radius:${size*0.075}px;background:#1a1a2e;display:flex;align-items:center;justify-content:center;font-size:${size*0.4}px;">?</div>`;
      return _svg(ch.bg, ch.draw, size);
    },

    getRandomId() {
      return CHARS[Math.floor(Math.random() * CHARS.length)].id;
    }
  };
})();
