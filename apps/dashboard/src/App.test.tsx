import { render, screen } from '@testing-library/react';
import { App } from './App';

describe('App shell', () => {
  it('renders the dashboard heading and a primary action', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Get started' })).toBeInTheDocument();
  });
});
