import { test, describe } from 'node:test';
import * as assert from 'node:assert';
import {
  MerkleTree,
  ManifestEngine,
  StateLedger,
  sha256,
} from '../src/index';

describe('Requirement 2: Checkpoint Ledger & Merkle Tree SHA-256 (FR-18)', () => {
  test('Deterministic Merkle tree calculation & SHA-256 Root', () => {
    const fileA = ManifestEngine.hashContent('export const A = 1;', 'src/a.ts');
    const fileB = ManifestEngine.hashContent('export const B = 2;', 'src/b.ts');
    const fileC = ManifestEngine.hashContent('export const C = 3;', 'src/c.ts');

    const tree1 = new MerkleTree([fileA, fileB, fileC]);
    // Same files in reversed input order must yield IDENTICAL Merkle root (deterministic sort)
    const tree2 = new MerkleTree([fileC, fileA, fileB]);

    assert.strictEqual(tree1.getRootHash(), tree2.getRootHash());
    assert.strictEqual(typeof tree1.getRootHash(), 'string');
    assert.strictEqual(tree1.getRootHash().length, 64); // SHA-256 hex string
  });

  test('Merkle audit proof generation and cryptographic verification', () => {
    const files = [
      ManifestEngine.hashContent('import React from "react";', 'src/App.tsx'),
      ManifestEngine.hashContent('export const Button = () => <button>Click</button>;', 'src/Button.tsx'),
      ManifestEngine.hashContent('export const Card = () => <div>Card</div>;', 'src/Card.tsx'),
      ManifestEngine.hashContent('export const theme = { primary: "#000" };', 'src/theme.ts'),
    ];

    const tree = new MerkleTree(files);
    const rootHash = tree.getRootHash();

    // Generate proof for src/Button.tsx
    const proof = tree.getProof('src/Button.tsx');
    assert.ok(proof);
    assert.strictEqual(proof?.path, 'src/Button.tsx');
    assert.ok(proof?.steps.length > 0);

    // Verify proof
    const isValid = MerkleTree.verifyProof(proof!, rootHash);
    assert.strictEqual(isValid, true);

    // Tampered proof must fail verification
    const tamperedProof = {
      ...proof!,
      leafHash: sha256('tampered_content'),
    };
    const isTamperedValid = MerkleTree.verifyProof(tamperedProof, rootHash);
    assert.strictEqual(isTamperedValid, false);
  });

  test('Version Manifest creation and Checkpoint Diffing', () => {
    // Version 1
    const v1Files = [
      ManifestEngine.hashContent('content v1 of file 1', 'src/file1.ts'),
      ManifestEngine.hashContent('content of file 2', 'src/file2.ts'),
      ManifestEngine.hashContent('will be deleted', 'src/file3.ts'),
    ];
    const manifestV1 = ManifestEngine.createManifest(v1Files, 1);

    // Version 2: file1 modified, file3 deleted, file4 added
    const v2Files = [
      ManifestEngine.hashContent('content v2 MODIFIED of file 1', 'src/file1.ts'),
      ManifestEngine.hashContent('content of file 2', 'src/file2.ts'), // unchanged
      ManifestEngine.hashContent('brand new file 4', 'src/file4.ts'), // added
    ];
    const manifestV2 = ManifestEngine.createManifest(v2Files, 2);

    const diff = ManifestEngine.diffManifests(manifestV1, manifestV2, 'chk-1', 'chk-2');

    assert.strictEqual(diff.addedFiles.length, 1);
    assert.strictEqual(diff.addedFiles[0].relativePath, 'src/file4.ts');

    assert.strictEqual(diff.modifiedFiles.length, 1);
    assert.strictEqual(diff.modifiedFiles[0].relativePath, 'src/file1.ts');

    assert.strictEqual(diff.deletedFiles.length, 1);
    assert.strictEqual(diff.deletedFiles[0].relativePath, 'src/file3.ts');

    assert.strictEqual(diff.unchangedFilesCount, 1);
  });

  test('Checkpoint Ledger saves, chains parent pointers, and restores snapshot from SQLite', () => {
    const ledger = new StateLedger(':memory:');

    // Create Checkpoint 1
    const chk1 = ledger.createCheckpoint({
      message: 'Initial project baseline',
      author: 'system',
      files: [
        { relativePath: 'src/App.tsx', content: 'export default function App() { return <h1>Hello</h1>; }' },
        { relativePath: 'src/index.css', content: 'body { margin: 0; }' },
      ],
      stateSnapshot: {
        lifecycleState: 'Gathering Brief',
      },
    });

    assert.ok(chk1.id);
    assert.strictEqual(chk1.parentCheckpointId, null);
    assert.strictEqual(chk1.manifest.files.length, 2);

    // Create Checkpoint 2 (child of Checkpoint 1)
    const chk2 = ledger.createCheckpoint({
      message: 'Added navbar component',
      author: 'user',
      files: [
        { relativePath: 'src/App.tsx', content: 'export default function App() { return <div><Nav /><h1>Hello</h1></div>; }' },
        { relativePath: 'src/Nav.tsx', content: 'export const Nav = () => <nav>Menu</nav>;' },
        { relativePath: 'src/index.css', content: 'body { margin: 0; }' },
      ],
      stateSnapshot: {
        lifecycleState: 'Preview Ready',
        activeRoute: '/home',
      },
    });

    assert.ok(chk2.id);
    assert.strictEqual(chk2.parentCheckpointId, chk1.id);
    assert.notStrictEqual(chk2.merkleRoot, chk1.merkleRoot);

    // Query checkpoint by ID from SQLite
    const retrievedChk = ledger.checkpoints.findById(chk2.id);
    assert.ok(retrievedChk);
    assert.strictEqual(retrievedChk?.message, 'Added navbar component');
    assert.strictEqual(retrievedChk?.manifest.files.length, 3);
    assert.strictEqual(retrievedChk?.parentCheckpointId, chk1.id);

    // Verify history listing
    const history = ledger.checkpoints.listHistory();
    assert.strictEqual(history.length, 2);
    assert.strictEqual(history[0].id, chk2.id); // Latest first
    assert.strictEqual(history[1].id, chk1.id);

    // Verify diffing between the two checkpoints
    const diff = ledger.diffCheckpoints(chk1.id, chk2.id);
    assert.strictEqual(diff.addedFiles.length, 1);
    assert.strictEqual(diff.addedFiles[0].relativePath, 'src/Nav.tsx');
    assert.strictEqual(diff.modifiedFiles.length, 1);
    assert.strictEqual(diff.modifiedFiles[0].relativePath, 'src/App.tsx');
    assert.strictEqual(diff.unchangedFilesCount, 1);

    ledger.close();
  });
});
