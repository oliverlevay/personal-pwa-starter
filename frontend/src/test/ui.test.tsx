import { it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from '../components/ui.tsx';

it('renders a button and fires onClick', () => {
  const onClick = vi.fn();
  render(<Button onClick={onClick}>Go</Button>);
  fireEvent.click(screen.getByText('Go'));
  expect(onClick).toHaveBeenCalledOnce();
});

it('applies the variant class', () => {
  render(<Button variant="danger">X</Button>);
  expect(screen.getByText('X')).toHaveClass('btn-danger');
});
