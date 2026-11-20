import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import App from './App.jsx';

test('renders the requested greeting', () => {
  expect(renderToStaticMarkup(<App />)).toBe(
    '<main><h1>hello kapil</h1></main>',
  );
});
