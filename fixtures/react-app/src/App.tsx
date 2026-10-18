import { useState } from 'react';
import { Card } from './Card';
import { SHARED_TITLE } from './strings';

export function App() {
  const [presses, setPresses] = useState(0);
  return (
    <main>
      <h1>Welcome to React</h1>
      <p className="lead">
        Edit me in place
      </p>
      <button data-testid="press" onClick={() => setPresses((n) => n + 1)}>Press me</button>
      <span data-testid="counter">{`Pressed ${presses} times`}</span>
      <Card title="Card title">Card body</Card>
      <p data-testid="shared">{SHARED_TITLE}</p>
      <p data-testid="entity">Tom &amp; Jerry</p>
      <select data-testid="size">
        <option value="s">Small</option>
        <option value="l">Large</option>
      </select>
    </main>
  );
}
