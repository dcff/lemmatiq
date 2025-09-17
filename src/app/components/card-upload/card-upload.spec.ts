import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CardUpload } from './card-upload';

describe('CardUpload', () => {
  let component: CardUpload;
  let fixture: ComponentFixture<CardUpload>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CardUpload]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CardUpload);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
