package com.example.admin.bolar.licensehelper;

import com.google.firebase.ml.vision.barcode.FirebaseVisionBarcode;

public class BarcodeInfo {

    public String city;
    public String stateUS;
    public String street;
    public String zipcode;
    public String birthDate;
    public String documentType;
    public String expDate;
    public String firstName;
    public String gender;
    public String issueDate;
    public String issuingCountry;
    public String lastName;
    public String licenseNumber;
    public String middleName;

    public BarcodeInfo(FirebaseVisionBarcode.DriverLicense rawData){

        this.city = rawData.getAddressCity();
        this.stateUS = rawData.getAddressState();
        this.street = rawData.getAddressStreet();
        this.zipcode = rawData.getAddressZip();
        this.birthDate = rawData.getBirthDate();
        this.documentType = rawData.getDocumentType();
        this.expDate = rawData.getExpiryDate();
        this.firstName = rawData.getFirstName();
        this.gender = rawData.getGender();
        this.issueDate = rawData.getIssueDate();
        this.issuingCountry = rawData.getIssuingCountry();
        this.lastName = rawData.getLastName();
        this.licenseNumber = rawData.getLicenseNumber();
        this.middleName = rawData.getMiddleName();

        //BarcodeInfo barcodeInfo = new BarcodeInfo();
//        barcodeInfo.city = rawData.getAddressCity();
//        barcodeInfo.stateUS = rawData.getAddressState();
//        barcodeInfo.street = rawData.getAddressStreet();
//        barcodeInfo.zipcode = rawData.getAddressZip();
//        barcodeInfo.birthDate = rawData.getBirthDate();
//        barcodeInfo.documentType = rawData.getDocumentType();
//        barcodeInfo.expDate = rawData.getExpiryDate();
//        barcodeInfo.firstName = rawData.getFirstName();
//        barcodeInfo.gender = rawData.getGender();
//        barcodeInfo.issueDate = rawData.getIssueDate();
//        barcodeInfo.issuingCountry = rawData.getIssuingCountry();
//        barcodeInfo.lastName = rawData.getLastName();
//        barcodeInfo.licenseNumber = rawData.getLicenseNumber();
//        barcodeInfo.middleName = rawData.getMiddleName();
        //return barcodeInfo;
    }

    public BarcodeInfo() {

    }
}
