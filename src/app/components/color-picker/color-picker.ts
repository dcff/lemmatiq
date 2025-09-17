import { Component, signal, effect } from '@angular/core';

@Component({
  selector: 'app-color-picker',
  templateUrl: './color-picker.html',
  styleUrl: './color-picker.css'
})
export class ColorPicker {
  // Signal to store the selected color
  highlightColor = signal('#ff6700');

  // Signal to store the font size
  customFontSize = signal(1);

  // Available font size options
  fontSizeOptions = [0.5, 0.7, 0.8, 1, 1.5, 2, 2.5, 3];

  constructor() {
  // Read the current CSS variable value on initialization
  const currentCssValue = getComputedStyle(document.documentElement)
    .getPropertyValue('--custom-font-size')
    .trim()
    .replace('rem', '');

  if (currentCssValue) {
    const numValue = parseFloat(currentCssValue);
    // Only set if it's one of our valid options
    if (this.fontSizeOptions.includes(numValue)) {
      this.customFontSize.set(numValue);
    }
  }

  // Effect: update the CSS variables whenever the signals change
  effect(() => {
    document.documentElement.style.setProperty(
      '--highlight-color',
      this.highlightColor()
    );

    document.documentElement.style.setProperty(
      '--custom-font-size',
      this.customFontSize() + 'rem'
    );
  });
}

  decreaseFontSize() {
    const currentIndex = this.fontSizeOptions.indexOf(this.customFontSize());
    if (currentIndex > 0) {
      this.customFontSize.set(this.fontSizeOptions[currentIndex - 1]);
    }
  }

  increaseFontSize() {
    const currentIndex = this.fontSizeOptions.indexOf(this.customFontSize());
    if (currentIndex < this.fontSizeOptions.length - 1) {
      this.customFontSize.set(this.fontSizeOptions[currentIndex + 1]);
    }
  }
}
