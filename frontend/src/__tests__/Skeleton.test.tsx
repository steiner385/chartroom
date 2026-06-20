import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Skeleton } from '../shell/Skeleton';

describe('Skeleton (#188)', () => {
  it('reserves the given height/width and is decorative (aria-hidden)', () => {
    const { container } = render(<Skeleton height={200} width="50%" />);
    const el = container.querySelector('.skeleton') as HTMLElement;
    expect(el).not.toBeNull();
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.style.height).toBe('200px');   // numeric → px, so it reserves layout height
    expect(el.style.width).toBe('50%');
  });

  it('defaults to full width and a 1em height', () => {
    const { container } = render(<Skeleton />);
    const el = container.querySelector('.skeleton') as HTMLElement;
    expect(el.style.width).toBe('100%');
    expect(el.style.height).toBe('1em');
  });
});
