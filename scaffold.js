const fs = require('fs');
const path = require('path');

const folders = [
  'src/models',
  'src/assets/icons',
  'src/assets/fonts',
  'src/components/bubble/BubbleOverlay',
  'src/components/bubble/FloatingResultCard',
  'src/components/banners/EkweBanner',
  'src/components/cards/TranscriptCard',
  'src/components/cards/TranslationCard',
  'src/components/cards/HistoryItem',
  'src/components/common/EkweButton',
  'src/components/common/LanguagePickerSheet',
  'src/components/common/AudioWaveform',
  'src/components/common/PermissionGate',
  'src/components/common/ThemeToggler',
  'src/screens/Onboarding',
  'src/screens/Home',
  'src/screens/Result',
  'src/screens/History',
  'src/screens/Settings',
  'src/services',
  'src/hooks',
  'src/store',
  'src/navigation',
  'src/constants',
  'src/utils',
  'src/types'
];

folders.forEach(folder => {
  fs.mkdirSync(folder, { recursive: true });
});

// Instruction: "Create every folder and an index.ts placeholder in each"
// Let's create an index.ts in each directory that is not assets/models or their parents if they are just grouping folders (though the easiest is just putting it everywhere inside src). 
// I'll run a quick recursive function to put an index.ts in every directory inside src EXCEPT assets and models.

const createIndexTs = (dirPath) => {
  const contents = fs.readdirSync(dirPath, { withFileTypes: true });
  let hasOtherFiles = false;
  contents.forEach(dirent => {
    if (dirent.isDirectory()) {
      createIndexTs(path.join(dirPath, dirent.name));
    }
  });
  
  // Don't put index.ts in fonts/icons/models
  if (dirPath.includes('assets') || dirPath.includes('models')) return;
  
  fs.writeFileSync(path.join(dirPath, 'index.ts'), '// placeholder\nexport {};\n');
};

createIndexTs('src');
console.log('Folders created');
