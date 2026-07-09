import { join } from 'node:path';
import { resolveImagePath } from '../src/main/pathGuard';

const IMG = join('G:', 'Drive', 'nakgwan-images');

test('정상 상대경로 — <imageRoot>/<id>/<rel> (output/episodes 없음)', () => {
  expect(resolveImagePath(IMG, 'ep1', 'renders/책상__row1.png'))
    .toBe(join(IMG, 'ep1', 'renders', '책상__row1.png'));
});

test('.. 탈출 차단', () => {
  expect(() => resolveImagePath(IMG, 'ep1', '../../secret.png')).toThrow(/이탈/);
});

test('id 자체의 경로 탈출 차단', () => {
  expect(() => resolveImagePath(IMG, 'ep1/../ep2', 'a.png')).toThrow();
  expect(() => resolveImagePath(IMG, '../../etc', 'a.png')).toThrow();
});
