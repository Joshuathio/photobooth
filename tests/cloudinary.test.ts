import { describe, expect, it } from 'vitest';
import {
  allSheetCell,
  attachmentUrl,
  croppedPhotoUrl,
  deliveryUrl,
  galleryLink,
  isCloudName,
  photoPublicId,
  photoUrl,
  publicId,
} from '../src/shared/cloudinary';

describe('cloudinary urls', () => {
  it('namespaces assets by session code', () => {
    expect(publicId('7K9XPQ', 'sheet')).toBe('booth/7K9XPQ/sheet');
    expect(publicId('7K9XPQ', 'gif')).toBe('booth/7K9XPQ/anim');
  });

  it('builds delivery and attachment urls', () => {
    expect(deliveryUrl('demo', '7K9XPQ', 'story')).toBe(
      'https://res.cloudinary.com/demo/image/upload/booth/7K9XPQ/story.jpg',
    );
    expect(attachmentUrl('demo', '7K9XPQ', 'gif')).toBe(
      'https://res.cloudinary.com/demo/image/upload/fl_attachment/booth/7K9XPQ/anim.gif',
    );
  });

  it('adds the session code to the gallery url', () => {
    expect(galleryLink('https://x.com/gallery.html', 'ABCDEF')).toBe('https://x.com/gallery.html?s=ABCDEF');
    expect(galleryLink('https://x.com/g?event=binus', 'ABCDEF')).toBe('https://x.com/g?event=binus&s=ABCDEF');
  });

  it('puts the cloud name in the link so the gallery looks in the right account', () => {
    expect(galleryLink('https://dearlyphotobooth.site/', 'ABCDEF', 'yudkryyf')).toBe(
      'https://dearlyphotobooth.site/?s=ABCDEF&c=yudkryyf',
    );
    // Something that isn't a cloud name is left out rather than sent along.
    expect(galleryLink('https://x.com/g', 'ABCDEF', 'bad name/..')).toBe('https://x.com/g?s=ABCDEF');
    expect(isCloudName('yudkryyf')).toBe(true);
    expect(isCloudName('')).toBe(false);
  });

  it('rejects a gallery url that is not a url', () => {
    expect(() => galleryLink('gallery.html', 'ABCDEF')).toThrow();
  });

  it('builds urls for the single photos', () => {
    expect(photoPublicId('7K9XPQ', 3)).toBe('booth/7K9XPQ/photo-3');
    expect(photoUrl('demo', '7K9XPQ', 3)).toBe('https://res.cloudinary.com/demo/image/upload/booth/7K9XPQ/photo-3.jpg');
    expect(photoUrl('demo', '7K9XPQ', 3, { width: 480, download: true })).toBe(
      'https://res.cloudinary.com/demo/image/upload/c_scale,w_480/fl_attachment:dearly-7K9XPQ-3/booth/7K9XPQ/photo-3.jpg',
    );
  });

  it('cuts old sessions\' photos out of the 8-photo sheet', () => {
    expect(allSheetCell(1)).toEqual({ x: 36, y: 36, w: 555, h: 370 });
    expect(allSheetCell(8)).toEqual({ x: 609, y: 1200, w: 555, h: 370 });
    expect(croppedPhotoUrl('demo', '7K9XPQ', 2, { download: true })).toBe(
      'https://res.cloudinary.com/demo/image/upload/c_crop,x_609,y_36,w_555,h_370/fl_attachment:dearly-7K9XPQ-2/booth/7K9XPQ/all.jpg',
    );
  });
});
