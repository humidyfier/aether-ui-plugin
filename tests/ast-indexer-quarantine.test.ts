import { test, describe } from 'node:test';
import * as assert from 'node:assert';
import {
  AstIndexer,
  UidInjector,
  QuarantineRegistry,
  AmbiguousDuplicateQuarantineException,
  AETHER_UID_ATTR,
  StateLedger,
} from '../src/index';

describe('Requirement 3: AST Indexer, Zero Production DOM Leak & Quarantine (FR-10, FR-11, FR-17)', () => {
  const sampleReactCode = `
import React, { useState, useEffect } from 'react';

interface HeaderProps {
  title: string;
  badgeCount?: number;
}

export function Header({ title, badgeCount }: HeaderProps) {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    console.log("Header mounted");
  }, []);

  return (
    <header className="header-bar">
      <h1 id="title">{title}</h1>
      {badgeCount && <span className="badge">{badgeCount}</span>}
      <button onClick={() => setIsOpen(!isOpen)}>Toggle</button>
    </header>
  );
}

export const HeroCard = ({ subtitle }: { subtitle: string }) => {
  return (
    <div className="card">
      <p>{subtitle}</p>
      <img src="/banner.png" alt="Hero Banner" />
    </div>
  );
};
  `;

  test('Symbol extraction: detects components, props, hooks, and JSX hierarchy', () => {
    const indexer = new AstIndexer();
    const indexResult = indexer.indexSource(sampleReactCode, 'src/components/Header.tsx');

    // 1. Verify Components Extracted
    assert.strictEqual(indexResult.components.length, 2);

    const headerComp = indexResult.components.find((c) => c.name === 'Header');
    assert.ok(headerComp);
    assert.strictEqual(headerComp?.kind, 'function');
    assert.strictEqual(headerComp?.isExported, true);
    assert.deepStrictEqual(headerComp?.hooksUsed, ['useState', 'useEffect']);
    assert.ok(headerComp?.propNames.includes('title'));
    assert.ok(headerComp?.propNames.includes('badgeCount'));

    const heroComp = indexResult.components.find((c) => c.name === 'HeroCard');
    assert.ok(heroComp);
    assert.strictEqual(heroComp?.kind, 'arrow');
    assert.ok(heroComp?.propNames.includes('subtitle'));

    // 2. Verify JSX elements extracted
    assert.ok(indexResult.jsxElements.length >= 6);
    const tagNames = indexResult.jsxElements.map((el) => el.tagName);
    assert.ok(tagNames.includes('header'));
    assert.ok(tagNames.includes('h1'));
    assert.ok(tagNames.includes('button'));
    assert.ok(tagNames.includes('div'));
    assert.ok(tagNames.includes('img'));
  });

  test('Dev-time data-aether-uid injection attaches stable UIDs to JSX elements', () => {
    const injection = UidInjector.injectDevUids(sampleReactCode, 'src/components/Header.tsx');

    assert.ok(injection.injectedCount > 0);
    assert.ok(injection.transformedCode.includes('data-aether-uid='));
    assert.ok(injection.uids.length > 0);

    // Each injected UID starts with aether- prefix
    for (const uid of injection.uids) {
      assert.ok(uid.startsWith('aether-'));
    }
  });

  test('Zero Production DOM Leak: completely strips dev UIDs and passes rigorous AST verification', () => {
    // 1. Inject dev UIDs
    const injection = UidInjector.injectDevUids(sampleReactCode, 'src/components/Header.tsx');
    assert.ok(injection.transformedCode.includes('data-aether-uid='));

    // 2. Strip dev UIDs for production
    const strippedCode = UidInjector.stripDevUids(injection.transformedCode, 'src/components/Header.tsx');

    // 3. String-level invariant: Zero data-aether-uid in the output
    assert.strictEqual(strippedCode.includes('data-aether-uid'), false);

    // 4. AST-level verification: No JSX attribute named data-aether-uid exists in the AST
    const verified = UidInjector.verifyZeroProductionLeak(strippedCode, 'src/components/Header.tsx');
    assert.strictEqual(verified, true);
  });

  test('Ambiguous Duplicate Quarantine Rule: Zero auto-resolution for duplicate UIDs', () => {
    const quarantineRegistry = new QuarantineRegistry();
    const indexer = new AstIndexer(quarantineRegistry);

    // Code containing identical duplicate data-aether-uid on two different elements
    const codeWithDuplicates = `
export const DuplicateTest = () => {
  return (
    <div>
      <button data-aether-uid="aether-col-duplicate-123">Submit</button>
      <a data-aether-uid="aether-col-duplicate-123" href="/cancel">Cancel</a>
    </div>
  );
};
    `;

    indexer.indexSource(codeWithDuplicates, 'src/DuplicateTest.tsx');

    // Invariant: The collision UID MUST be quarantined
    const isQuarantined = quarantineRegistry.isQuarantined('aether-col-duplicate-123');
    assert.strictEqual(isQuarantined, true);

    const quarantinedList = quarantineRegistry.getQuarantinedRecords();
    assert.strictEqual(quarantinedList.length, 1);
    assert.strictEqual(quarantinedList[0].uid, 'aether-col-duplicate-123');
    assert.strictEqual(quarantinedList[0].occurrences.length, 2);
    assert.strictEqual(quarantinedList[0].occurrences[0].tagName, 'button');
    assert.strictEqual(quarantinedList[0].occurrences[1].tagName, 'a');

    // Invariant: Zero auto-resolution. Mutation attempt must throw AmbiguousDuplicateQuarantineException!
    assert.throws(
      () => {
        quarantineRegistry.assertNotQuarantined('aether-col-duplicate-123');
      },
      (err: any) => {
        assert.ok(err instanceof AmbiguousDuplicateQuarantineException);
        assert.ok(err.message.includes('Auto-resolution is forbidden'));
        return true;
      }
    );
  });

  test('Cross-file UID duplication triggers quarantine and syncs to SQLite ledger', () => {
    const ledger = new StateLedger(':memory:');
    const indexer = new AstIndexer(ledger.quarantineRegistry);

    const file1Code = `
export const CompA = () => <div data-aether-uid="aether-global-dupe">A</div>;
    `;
    const file2Code = `
export const CompB = () => <span data-aether-uid="aether-global-dupe">B</span>;
    `;

    indexer.indexSource(file1Code, 'src/CompA.tsx');
    indexer.indexSource(file2Code, 'src/CompB.tsx');

    assert.strictEqual(ledger.quarantineRegistry.isQuarantined('aether-global-dupe'), true);

    // Sync to SQLite ledger
    ledger.syncQuarantinedDuplicates();

    const storedRecord = ledger.quarantineRepo.findByUid('aether-global-dupe');
    assert.ok(storedRecord);
    assert.strictEqual(storedRecord?.status, 'ACTIVE');
    assert.ok(storedRecord?.occurrences.length >= 2);

    ledger.close();
  });
});
